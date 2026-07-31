import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { recognizeLabelWithBedrock } from '@/lib/agent/labelDirect';
import { enrichLabelExtraction } from '@/lib/agent/labelEnrich';
import { resolveSearchProvider } from '@/lib/search/serpapi';

const RequestBody = z.object({
  imageKey: z.string().min(1),
  hint: z.string().max(500).optional(),
});

/**
 * POST /api/labels/analyze — 라벨 인식 에이전트 호출 (9.7).
 *
 * **편집자 가드 필수** — 모델 호출(Bedrock 비용)을 유발하는 엔드포인트이므로
 * 공개 접근을 허용하면 비용 사고로 직결된다 (design.md 'API 계약').
 * `withEditorGuard` 가 미인증 요청을 401로 차단한 뒤에만 에이전트를 호출한다.
 */
export const POST = withEditorGuard(async (request: NextRequest) => {
  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  try {
    const { imageKey } = parsed.data;

    /*
     * 라벨 인식은 **Bedrock 을 직접 호출한다.**
     *
     * AgentCore 의 라벨 에이전트는 프롬프트에 S3 키를 문자열로만 넘기고 이미지 자체를
     * 모델에 전달하지 않는다(`agent/src/entrypoint.ts` 의 analyze_label). 그래서
     * 모델이 "이미지에 접근할 수 없다"고 답하며 항상 `recognized: false` 가 됐다.
     * 이미지를 읽어 Converse 이미지 블록으로 넣는 경로는 `lib/agent/labelDirect.ts` 에
     * 이미 있으므로 그것을 정식 경로로 쓴다.
     *
     * 에이전트 경로로 되돌리려면 entrypoint 가 S3 에서 이미지를 읽어 모델 입력에
     * 이미지 블록으로 실어야 한다. 그 전에는 이 경로가 유일하게 동작한다.
     */
    // hint 는 현재 직접 경로에서 쓰지 않는다. 모델은 이미지만으로 라벨을 읽는다.
    const recognized = await recognizeLabelWithBedrock(imageKey);

    /*
     * 인식된 라벨에 품종·지역·도수가 비어 있으면 보강한다 (R3).
     * 그 값들이 있어야 취향 분석(R7)·패턴 탐색(R8)의 축으로 쓸 수 있다.
     * `WAGANDA_LABEL_ENRICH=0` 으로 끌 수 있다(모델 호출을 아끼고 싶을 때).
     */
    if (!recognized.recognized || process.env.WAGANDA_LABEL_ENRICH === '0') {
      return NextResponse.json({ label: recognized, via: 'bedrock-direct' });
    }

    // 검색 키가 있으면 검색 근거로 채우고, 없으면 모델 지식만으로 채운다
    // (키는 환경변수 또는 SSM SecureString 에서 해석한다)
    const enriched = await enrichLabelExtraction(recognized, {
      search: await resolveSearchProvider(),
    });
    return NextResponse.json({
      label: enriched.extraction,
      via: 'bedrock-direct',
      enrichedFields: enriched.filled,
    });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
