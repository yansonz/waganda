import { NextResponse, type NextRequest } from 'next/server';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { toDomainErrorResponse, parseJsonBody } from '@/lib/api/errors';
import { validateRecordingUploadRequest } from '@/lib/upload/validate';
import { presignRecordingUpload } from '@/lib/upload/presign';
import { DynamoDbRepository } from '@/lib/db/repository';
import { createRecording } from '@/lib/services/tastings';

/**
 * POST /api/tastings/[id]/recordings — S3 사전 서명 업로드 URL 발급 + Recording 레코드 생성 (7.4).
 *
 * 형식·크기·길이 위반은 한국어 사유와 함께 거부하고(lib/upload/validate.ts),
 * 세션당 최대 3개 제한은 lib/services/tastings.ts 의 createRecording 이 검증한다.
 * 편집자 가드 적용 (쓰기 라우트).
 */
export const POST = withEditorGuard(async (request: NextRequest) => {
  // 경로: /api/tastings/[id]/recordings — 뒤에서 두 번째 세그먼트가 tastingId
  const segments = request.nextUrl.pathname.split('/');
  const tastingId = segments.at(-2)!;

  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const validation = validateRecordingUploadRequest(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.code ?? 'VALIDATION_ERROR', message: validation.reason },
      { status: 400 },
    );
  }

  const repo = new DynamoDbRepository();

  try {
    const presigned = await presignRecordingUpload({
      tastingId,
      format: validation.data.format,
    });

    await createRecording(repo, {
      id: presigned.recordingId,
      tastingId,
      audioKey: presigned.audioKey,
      format: validation.data.format,
      durationSec: validation.data.durationSec,
      sizeBytes: validation.data.sizeBytes,
    });

    return NextResponse.json(
      {
        recordingId: presigned.recordingId,
        uploadUrl: presigned.uploadUrl,
        audioKey: presigned.audioKey,
        expiresInSec: presigned.expiresInSec,
      },
      { status: 201 },
    );
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
