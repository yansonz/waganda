import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { WinePatch } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { invalidateCache } from '@/lib/cache/invalidate';
import { DynamoDbRepository, requireFound } from '@/lib/db/repository';
import { deleteWine, updateWine } from '@/lib/services/wines';

const PatchBody = WinePatch.extend({ rev: z.number().int().min(0) });

/** PATCH /api/wines/[id] — 와인 수정 (6.2). 편집자 가드 적용. */
export const PATCH = withEditorGuard(async (request: NextRequest) => {
  const id = request.nextUrl.pathname.split('/').at(-1)!;

  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  const repo = new DynamoDbRepository();
  const { rev, ...patch } = parsed.data;

  try {
    const wine = await updateWine(repo, id, rev, patch);
    await invalidateCache();
    return NextResponse.json({ wine });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});

/** DELETE /api/wines/[id] — 와인 삭제 (6.2). 시음 기록이 있으면 거부한다. */
export const DELETE = withEditorGuard(async (request: NextRequest) => {
  const id = request.nextUrl.pathname.split('/').at(-1)!;
  const repo = new DynamoDbRepository();

  try {
    requireFound(await repo.getWine(id), '삭제할 와인을 찾을 수 없습니다.');
    await deleteWine(repo, id);
    await invalidateCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
