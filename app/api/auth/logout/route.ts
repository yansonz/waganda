import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth/session';
import { absoluteUrl } from '@/lib/config';

/**
 * 로그아웃. 세션 쿠키를 삭제한 뒤 대시보드로 리다이렉트한다.
 * JWT 는 stateless 이므로 서버 세션 저장소를 정리할 필요가 없다 (design.md 인증 설계).
 *
 * 쿠키 삭제도 **응답 객체에 직접** 지정한다 —
 * `cookies().delete()` 후 별도 리다이렉트 응답을 반환하면 Set-Cookie 가 누락될 수 있다.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(absoluteUrl('/'), { status: 302 });
  response.cookies.delete(COOKIE_NAME);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
