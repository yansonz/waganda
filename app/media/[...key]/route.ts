import { NextResponse } from 'next/server';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getRuntimeConfig } from '@/lib/config';

/**
 * GET /media/[...key] — **로컬 전용** 미디어 프록시.
 *
 * 프로덕션에서는 CloudFront 의 `/media/*` 동작이 S3 오리진으로 직접 보내므로
 * 이 라우트에 요청이 도달하지 않는다(web-stack.ts 캐시 정책).
 * 로컬에는 CDN 이 없어 업로드한 라벨 사진·녹음을 볼 수 없으므로,
 * `WAGANDA_S3_ENDPOINT` 가 설정된 환경에서만 로컬 S3 에서 읽어 내려준다.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const endpoint = process.env.WAGANDA_S3_ENDPOINT;
  if (!endpoint) {
    // 프로덕션 경로에서는 CDN 이 처리한다 — 앱이 미디어를 서빙하지 않는다.
    return new NextResponse('Not Found', { status: 404 });
  }

  const { key } = await context.params;
  const objectKey = key.map((segment) => decodeURIComponent(segment)).join('/');

  const config = getRuntimeConfig();
  const s3 = new S3Client({
    region: config.region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });

  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: config.mediaBucket, Key: objectKey }),
    );
    const body = await result.Body?.transformToByteArray();
    if (!body) return new NextResponse('Not Found', { status: 404 });

    return new NextResponse(new Uint8Array(body), {
      headers: {
        'content-type': result.ContentType ?? 'application/octet-stream',
        // 로컬 확인용이므로 캐시하지 않는다
        'cache-control': 'no-store',
      },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
