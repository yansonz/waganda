import { NextResponse, type NextRequest } from 'next/server';
import { withEditorGuard } from '@/lib/auth/guard';
import { convertHeicToJpeg } from '@/lib/upload/heic';

/**
 * POST /api/labels/convert — HEIC/HEIF 사진을 JPEG 로 변환한다.
 *
 * 요청: 원본 바이트를 그대로 본문에 담아 보낸다 (`content-type: image/heic`).
 * 응답: JPEG 바이트.
 *
 * 편집자 가드를 적용한다 — 변환은 CPU 를 쓰므로 공개하지 않는다 (R10).
 */
export const POST = withEditorGuard(async (request: NextRequest) => {
  const buffer = Buffer.from(await request.arrayBuffer());
  const result = await convertHeicToJpeg(buffer);

  if (!result.ok) {
    return NextResponse.json({ error: result.code, message: result.message }, { status: 400 });
  }

  return new NextResponse(result.jpeg, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'no-store',
    },
  });
});
