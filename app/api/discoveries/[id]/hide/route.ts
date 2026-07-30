import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { invalidateCache } from '@/lib/cache/invalidate';
import { DynamoDbRepository } from '@/lib/db/repository';
import { hideDiscovery } from '@/lib/services/discoveries';

const PatchBody = z.object({ rev: z.number().int().min(0) });

/** PATCH /api/discoveries/[id]/hide — 발견 카드 숨김 처리 (13.5). 편집자 가드 적용. */
export const PATCH = withEditorGuard(async (request: NextRequest) => {
  const id = request.nextUrl.pathname.split('/').at(-2)!;

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

  try {
    const discovery = await hideDiscovery(repo, id, parsed.data.rev);
    await invalidateCache();
    return NextResponse.json({ discovery });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
