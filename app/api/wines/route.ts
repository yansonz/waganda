import { NextResponse, type NextRequest } from 'next/server';
import { WineInput } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { invalidateCache } from '@/lib/cache/invalidate';
import { DynamoDbRepository } from '@/lib/db/repository';
import { createWine, findDuplicateCandidates } from '@/lib/services/wines';

/**
 * POST /api/wines — 와인 생성 (6.2). 편집자 가드 적용.
 * 이름+빈티지+와이너리 조합의 중복 후보가 있으면 생성 대신 후보를 반환한다.
 */
export const POST = withEditorGuard(async (request: NextRequest) => {
  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = WineInput.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  const repo = new DynamoDbRepository();

  try {
    const candidates = await findDuplicateCandidates(repo, {
      name: parsed.data.name,
      vintage: parsed.data.vintage,
      wineryId: parsed.data.wineryId,
    });

    if (candidates.length > 0) {
      return NextResponse.json({ duplicateCandidates: candidates }, { status: 200 });
    }

    const wine = await createWine(repo, parsed.data);
    await invalidateCache();
    return NextResponse.json({ wine }, { status: 201 });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
