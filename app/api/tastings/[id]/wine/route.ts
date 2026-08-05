import { NextResponse, type NextRequest } from 'next/server';
import { TastingWineAttachmentInput } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { DynamoDbRepository } from '@/lib/db/repository';
import { attachWineToTasting } from '@/lib/services/tastings';

/**
 * POST /api/tastings/[id]/wine — 미연결 캡처에 라벨 인식·수동 확인 와인을 연결한다.
 * 공개 가능한 분석이 아직 없으므로 여기서는 CDN 캐시를 무효화하지 않는다.
 */
export const POST = withEditorGuard(async (request: NextRequest) => {
  const tastingId = request.nextUrl.pathname.split('/').at(-2)!;
  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = TastingWineAttachmentInput.safeParse(body);
  if (!parsed.success) return toDomainErrorResponse(parsed.error)!;

  const repo = new DynamoDbRepository();
  try {
    const tasting = await attachWineToTasting(repo, tastingId, parsed.data);
    return NextResponse.json({ tasting });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
