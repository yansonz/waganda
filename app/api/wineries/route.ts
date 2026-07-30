import { NextResponse, type NextRequest } from 'next/server';
import { WineryInput } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { invalidateCache } from '@/lib/cache/invalidate';
import { DynamoDbRepository } from '@/lib/db/repository';
import { createWinery } from '@/lib/services/wines';

/** POST /api/wineries — 와이너리 생성 (6.3). 편집자 가드 적용. */
export const POST = withEditorGuard(async (request: NextRequest) => {
  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = WineryInput.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  const repo = new DynamoDbRepository();

  try {
    const winery = await createWinery(repo, parsed.data);
    await invalidateCache();
    return NextResponse.json({ winery }, { status: 201 });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
