import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { parseJsonBody, toDomainErrorResponse } from '@/lib/api/errors';
import {
  LABEL_IMAGE_TYPES,
  MAX_LABEL_IMAGE_BYTES,
  presignFoodImageUpload,
} from '@/lib/upload/presign';
import { DynamoDbRepository } from '@/lib/db/repository';
import { addFoodPhoto, removeFoodPhoto } from '@/lib/services/tastings';
import { invalidateCache } from '@/lib/cache/invalidate';

/**
 * POST /api/tastings/[id]/food-photos — 음식 사진 업로드용 사전 서명 URL 발급.
 * PATCH /api/tastings/[id]/food-photos — 업로드 완료 후 키 등록.
 * DELETE /api/tastings/[id]/food-photos — 음식 사진 제거.
 *
 * 모든 메서드에 편집자 가드 적용.
 */

const PresignRequest = z.object({
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(1),
});

const ConfirmRequest = z.object({
  imageKey: z.string().min(1).max(512),
  rev: z.number().int().min(0),
});

const RemoveRequest = z.object({
  imageKey: z.string().min(1).max(512),
  rev: z.number().int().min(0),
});

/** tastingId를 URL 경로에서 추출한다 */
function extractTastingId(request: NextRequest): string {
  // 경로: /api/tastings/[id]/food-photos — 뒤에서 두 번째 세그먼트가 tastingId
  const segments = request.nextUrl.pathname.split('/');
  return segments.at(-2)!;
}

export const POST = withEditorGuard(async (request: NextRequest) => {
  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = PresignRequest.safeParse(body);
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
    const result = await presignFoodImageUpload({ contentType });
    return NextResponse.json(result);
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});

export const PATCH = withEditorGuard(async (request: NextRequest) => {
  const tastingId = extractTastingId(request);

  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = ConfirmRequest.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  const repo = new DynamoDbRepository();

  try {
    const tasting = await addFoodPhoto(repo, tastingId, parsed.data.rev, parsed.data.imageKey);
    await invalidateCache();
    return NextResponse.json({ tasting });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});

export const DELETE = withEditorGuard(async (request: NextRequest) => {
  const tastingId = extractTastingId(request);

  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parsed = RemoveRequest.safeParse(body);
  if (!parsed.success) {
    return toDomainErrorResponse(parsed.error)!;
  }

  const repo = new DynamoDbRepository();

  try {
    const tasting = await removeFoodPhoto(repo, tastingId, parsed.data.rev, parsed.data.imageKey);
    await invalidateCache();
    return NextResponse.json({ tasting });
  } catch (error) {
    const response = toDomainErrorResponse(error) ?? toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
