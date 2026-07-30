import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { LabelExtraction } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { invokeAgentRuntime } from '@/lib/agent/client';
import { isDirectLabelFallbackEnabled, recognizeLabelWithBedrock } from '@/lib/agent/labelDirect';
import { enrichLabelExtraction } from '@/lib/agent/labelEnrich';
import { resolveSearchProvider } from '@/lib/search/serpapi';
import { getRuntimeConfig } from '@/lib/config';

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
    const { imageKey, hint } = parsed.data;
    const config = getRuntimeConfig();

    /*
     * 정상 경로는 AgentCore Runtime 의 라벨 에이전트다.
     * 아직 배포되지 않은 환경(로컬)에서는 `WAGANDA_LABEL_FALLBACK=bedrock` 을 켜
     * Bedrock 을 직접 호출한다 — 같은 `LabelExtraction` 계약을 지킨다.
     */
    if (!config.agentRuntimeArn) {
      if (!isDirectLabelFallbackEnabled()) {
        return NextResponse.json(
          {
            error: 'LABEL_AGENT_UNAVAILABLE',
            message:
              '라벨 인식 서비스가 설정되지 않았습니다. (WAGANDA_AGENT_RUNTIME_ARN 미설정, 로컬에서는 WAGANDA_LABEL_FALLBACK=bedrock 사용)',
          },
          { status: 503 },
        );
      }

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
    }

    // 라벨 인식은 특정 시음 세션에 종속되지 않으므로 imageKey 기반 세션 식별자를 쓴다.
    const result = await invokeAgentRuntime(imageKey, {
      task: 'analyze_label',
      imageKey,
      hint,
    });

    const label = result.label ? LabelExtraction.parse(result.label) : undefined;
    return NextResponse.json({ label, traceId: result.traceId });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
