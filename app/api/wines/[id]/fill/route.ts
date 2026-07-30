import { NextResponse, type NextRequest } from 'next/server';
import { WinePatch } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { parseJsonBody, toDomainErrorResponse } from '@/lib/api/errors';
import { DynamoDbRepository } from '@/lib/db/repository';
import { fillMissingWineFields } from '@/lib/services/wines';
import { invalidateCache } from '@/lib/cache/invalidate';

/**
 * POST /api/wines/[id]/fill — 비어 있는 필드만 채운다.
 *
 * 같은 와인을 다시 마셨을 때(중복 후보로 기존 와인에 시음을 붙이는 경우)
 * 라벨 인식·보강으로 새로 알아낸 정보를 버리지 않기 위한 경로다.
 * **기존 값은 덮어쓰지 않는다** — 편집자가 손으로 고친 값이 보존된다.
 */
export const POST = withEditorGuard(async (request: NextRequest) => {
  const id = request.nextUrl.pathname.split('/').at(-2)!;

  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = WinePatch.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  try {
    const result = await fillMissingWineFields(new DynamoDbRepository(), id, parsed.data);
    if (result.filled.length > 0) await invalidateCache();
    return NextResponse.json({ wine: result.wine, filled: result.filled });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
