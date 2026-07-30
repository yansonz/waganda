import { NextResponse } from 'next/server';
import { getEditorSession } from '@/lib/auth/session';

/**
 * GET /api/auth/session — 현재 편집자 세션 상태 조회.
 *
 * 왜 API 로 두는가:
 * 공개 페이지는 CloudFront 장기 캐시 대상이다(design.md 캐시 전략).
 * 서버 렌더 HTML 에 로그인 여부에 따라 다른 UI 를 넣으면 캐시된 응답이
 * 다른 방문자에게 섞여 나간다. 그래서 HTML 은 **항상 비로그인 형태**로 두고,
 * 쓰기 UI 노출 여부만 브라우저에서 이 엔드포인트로 판별한다.
 *
 * 반환값에는 편집 가능 여부와 본인 이메일만 담는다.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getEditorSession();

  return NextResponse.json(
    session ? { authenticated: true, email: session.email } : { authenticated: false },
    {
      // 세션 응답은 절대 캐시하지 않는다 (CDN·브라우저 모두)
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
