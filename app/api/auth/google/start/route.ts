import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig, googleRedirectUri } from '@/lib/config';
import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_RETURN_TO_COOKIE_NAME,
  oauthFlowCookieOptions,
} from '@/lib/auth/session';

/**
 * Google OAuth 인증 시작.
 *
 * - state 난수를 생성해 HttpOnly 쿠키에 저장한다 (CSRF 방어, 콜백에서 대조).
 * - returnTo 는 오픈 리다이렉트 방지를 위해 **내부 경로만** 허용한다.
 *   '//' 로 시작하거나 절대 URL(scheme 포함)이면 거부하고 기본 경로로 대체한다.
 * - Google 인증 화면으로 302 리다이렉트한다.
 */

const DEFAULT_RETURN_TO = '/';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * returnTo 값이 안전한 내부 경로인지 검증한다.
 * - '/' 로 시작해야 한다
 * - '//' 로 시작하면 거부한다 (프로토콜 상대 URL을 이용한 오픈 리다이렉트)
 * - scheme(예: 'https:', 'javascript:')이 포함된 절대 URL은 거부한다
 */
function sanitizeReturnTo(raw: string | null): string {
  if (!raw) return DEFAULT_RETURN_TO;

  // 절대 URL(scheme 포함) 거부 — 예: https://evil.com, javascript:alert(1)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    return DEFAULT_RETURN_TO;
  }

  // '/' 로 시작하지 않으면 내부 경로가 아니다
  if (!raw.startsWith('/')) {
    return DEFAULT_RETURN_TO;
  }

  // '//' 로 시작하면 프로토콜 상대 URL로 해석되어 외부로 리다이렉트될 수 있다
  if (raw.startsWith('//')) {
    return DEFAULT_RETURN_TO;
  }

  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = await getAuthConfig();
  const requestedReturnTo = request.nextUrl.searchParams.get('returnTo');
  const returnTo = sanitizeReturnTo(requestedReturnTo);

  const state = crypto.randomUUID();

  const flowCookieOptions = oauthFlowCookieOptions();

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', config.googleClientId);
  authUrl.searchParams.set('redirect_uri', googleRedirectUri());
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'online');
  authUrl.searchParams.set('prompt', 'select_account');

  // 콜백은 이 쿠키로 state 를 대조한다. 리다이렉트 응답에 확실히 실리도록
  // `cookies()` 대신 응답 객체에 직접 설정한다.
  const response = NextResponse.redirect(authUrl.toString(), { status: 302 });
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, flowCookieOptions);
  response.cookies.set(OAUTH_RETURN_TO_COOKIE_NAME, returnTo, flowCookieOptions);

  return response;
}
