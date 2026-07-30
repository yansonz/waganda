/**
 * middleware.ts — `/api/*` 경로에 IP 속도 제한을 적용한다 (15.4).
 *
 * design.md 'CSRF 와 남용 방지': 공개 페이지는 대부분 CDN 이 처리하므로
 * 속도 제한의 실질 대상은 API 경로다. IP 는 해싱해서만 사용한다.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit, extractClientIp, hashIp } from '@/lib/ratelimit';

export const config = {
  matcher: '/api/:path*',
  // Edge 런타임에서는 AWS SDK v3 와 node:crypto 를 쓸 수 없어 Node.js 런타임을 지정한다.
  // (next.config.ts 의 experimental.nodeMiddleware 와 함께 동작한다)
  runtime: 'nodejs',
};

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const ip = extractClientIp(request.headers);
  const ipHash = hashIp(ip);

  try {
    const result = await checkRateLimit(ipHash);

    if (!result.allowed) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
        },
        { status: 429, headers: { 'Retry-After': String(result.windowSec) } },
      );
    }

    return NextResponse.next();
  } catch (error) {
    // 속도 제한 인프라 장애가 전체 API 를 막아서는 안 된다 — 열어 두고 통과시킨다.
    console.error('[middleware] 속도 제한 검사 실패 — 통과 처리:', error);
    return NextResponse.next();
  }
}
