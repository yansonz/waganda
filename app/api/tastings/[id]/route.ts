import { NextResponse, type NextRequest } from 'next/server';
import { TastingPatch } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { invalidateCache } from '@/lib/cache/invalidate';
import { DynamoDbRepository, requireFound } from '@/lib/db/repository';
import { deleteTasting, updateTasting } from '@/lib/services/tastings';

/**
 * PATCH /api/tastings/[id] — 수동 평점, 요약·하이라이트 수정 (11.9).
 * 원본 AI 생성물(Analysis.summary/highlights)은 절대 덮어쓰지 않는다 — editedSummary/editedHighlights 로만 기록.
 * 편집자 가드 적용.
 */
export const PATCH = withEditorGuard(async (request: NextRequest) => {
  const id = request.nextUrl.pathname.split('/').at(-1)!;

  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = TastingPatch.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  const repo = new DynamoDbRepository();
  const expectedRev = parsed.data.rev ?? 0;

  try {
    const result = await updateTasting(repo, id, expectedRev, parsed.data);
    await invalidateCache();
    return NextResponse.json(result);
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});

/** DELETE /api/tastings/[id] — 시음 세션 삭제. 편집자 가드 적용. */
export const DELETE = withEditorGuard(async (request: NextRequest) => {
  const id = request.nextUrl.pathname.split('/').at(-1)!;
  const repo = new DynamoDbRepository();

  try {
    requireFound(await repo.getTasting(id), '삭제할 시음 세션을 찾을 수 없습니다.');
    await deleteTasting(repo, id);
    await invalidateCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
