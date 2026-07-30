import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SpeakerOverrideRequest } from '@waganda/schemas';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { invalidateCache } from '@/lib/cache/invalidate';
import { DynamoDbRepository, requireFound } from '@/lib/db/repository';
import { overrideSpeakerMapping } from '@/lib/services/tastings';

const PatchBody = SpeakerOverrideRequest.extend({
  tastingId: z.string().min(1),
  rev: z.number().int().min(0),
});

/**
 * PATCH /api/recordings/[id]/speakers — 화자 매핑 교체 (오판 정정) (11.10).
 *
 * 녹음은 `TASTING#<id>` 파티션에 속하므로 tastingId 를 요청 본문으로 함께 받는다
 * (design.md 키 구조: 녹음의 pk 는 시음 세션과 동일한 TASTING#<id>).
 * 편집자 가드 적용.
 */
export const PATCH = withEditorGuard(async (request: NextRequest) => {
  const recordingId = request.nextUrl.pathname.split('/').at(-2)!;

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
    requireFound(
      await repo.getRecording(parsed.data.tastingId, recordingId),
      '수정할 녹음을 찾을 수 없습니다.',
    );

    const recording = await overrideSpeakerMapping(
      repo,
      parsed.data.tastingId,
      recordingId,
      parsed.data.rev,
      parsed.data.mapping,
    );

    await invalidateCache();
    return NextResponse.json({ recording });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
