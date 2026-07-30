import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { parseJsonBody, toDomainErrorResponse } from '@/lib/api/errors';
import {
  LABEL_IMAGE_TYPES,
  MAX_LABEL_IMAGE_BYTES,
  presignLabelImageUpload,
} from '@/lib/upload/presign';

/**
 * POST /api/labels/upload — 라벨 사진 업로드용 사전 서명 URL 발급.
 *
 * 라벨 인식은 S3 객체를 읽으므로 업로드가 먼저 이뤄져야 한다.
 * 편집자 가드를 적용한다 — 저장 공간과 이후 모델 호출 비용을 보호한다 (R1, R10).
 */
const RequestBody = z.object({
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(1),
});

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

  const { contentType, sizeBytes } = parsed.data;

  if (!LABEL_IMAGE_TYPES[contentType]) {
    return NextResponse.json(
      {
        error: 'UNSUPPORTED_IMAGE_TYPE',
        message: `지원하지 않는 이미지 형식입니다. (지원: ${Object.keys(LABEL_IMAGE_TYPES).join(', ')})`,
      },
      { status: 400 },
    );
  }

  if (sizeBytes > MAX_LABEL_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: 'IMAGE_TOO_LARGE',
        message: `사진 용량이 너무 큽니다. ${Math.floor(MAX_LABEL_IMAGE_BYTES / (1024 * 1024))}MB 이하로 올려주세요.`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await presignLabelImageUpload({ contentType });
    return NextResponse.json(result);
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
