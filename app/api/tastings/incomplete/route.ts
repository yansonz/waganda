import { NextResponse, type NextRequest } from 'next/server';
import { withEditorGuard, toErrorResponse } from '@/lib/auth/guard';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getIncompleteTastingCaptureView } from '@/lib/views/read';

/**
 * GET /api/tastings/incomplete — 입력 보완이 필요한 편집자 전용 캡처 목록.
 * 공개 타임라인과 RSS에는 포함하지 않으며, `/record`에서 이어쓰기 카드로만 쓴다.
 */
export const GET = withEditorGuard(async (request: NextRequest) => {
  try {
    const captures = await getIncompleteTastingCaptureView(new DynamoDbRepository());
    return NextResponse.json({ captures });
  } catch (error) {
    const response = toErrorResponse(error, request);
    if (response) return response;
    throw error;
  }
});
