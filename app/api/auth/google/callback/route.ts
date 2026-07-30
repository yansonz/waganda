import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthConfig, googleRedirectUri, absoluteUrl } from '@/lib/config';
import {
  COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_RETURN_TO_COOKIE_NAME,
  editorCookieOptions,
  isAllowedEmail,
  signEditorJWT,
} from '@/lib/auth/session';

/**
 * Google OAuth 콜백.
 *
 * 흐름:
 * 1. state 쿠키와 쿼리 state 대조 (불일치 → 세션 미발급)
 * 2. code → access_token 교환
 * 3. access_token → userinfo 조회
 * 4. verified_email 확인
 * 5. 허용 목록 확인
 * 6. 성공 시 JWT 발급 후 쿠키 설정, returnTo 로 302
 *
 * 실패 시 세션을 발급하지 않고 이메일을 마스킹해 console.warn 으로 시도를 기록한다.
 * (서버 confidential client 이므로 PKCE 는 적용하지 않고 state 대조로 CSRF 를 방어한다.)
 */

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const DEFAULT_RETURN_TO = '/';
const LOGIN_FAILURE_REDIRECT = '/?login=failed';

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface GoogleUserInfoResponse {
  email?: string;
  verified_email?: boolean;
  email_verified?: boolean;
}

/**
 * 이메일을 로그용으로 마스킹한다. 전체 노출을 피하고 진단 가능한 최소 정보만 남긴다.
 * 예: "yan@example.com" → "y**@example.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

async function clearOauthFlowCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(OAUTH_STATE_COOKIE_NAME);
  cookieStore.delete(OAUTH_RETURN_TO_COOKIE_NAME);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = await getAuthConfig();
  const cookieStore = await cookies();

  const queryState = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const savedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const returnTo = cookieStore.get(OAUTH_RETURN_TO_COOKIE_NAME)?.value ?? DEFAULT_RETURN_TO;

  // state 불일치 → 세션 미발급. 쿠키는 재사용 방지를 위해 정리한다.
  if (!queryState || !savedState || queryState !== savedState) {
    console.warn('[auth] OAuth state 불일치 — 세션을 발급하지 않습니다.');
    await clearOauthFlowCookies();
    return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
      status: 302,
    });
  }

  await clearOauthFlowCookies();

  if (!code) {
    console.warn('[auth] OAuth 콜백에 code 가 없습니다 — 세션을 발급하지 않습니다.');
    return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
      status: 302,
    });
  }

  // code → access_token 교환
  let tokenData: GoogleTokenResponse;
  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: googleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      console.warn(`[auth] Google 토큰 교환 실패 — status=${tokenResponse.status}`);
      return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
        status: 302,
      });
    }

    tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
  } catch (error) {
    console.warn('[auth] Google 토큰 교환 중 네트워크 오류', error);
    return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
      status: 302,
    });
  }

  // access_token → userinfo 조회
  let userInfo: GoogleUserInfoResponse;
  try {
    const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoResponse.ok) {
      console.warn(`[auth] Google userinfo 조회 실패 — status=${userInfoResponse.status}`);
      return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
        status: 302,
      });
    }

    userInfo = (await userInfoResponse.json()) as GoogleUserInfoResponse;
  } catch (error) {
    console.warn('[auth] Google userinfo 조회 중 네트워크 오류', error);
    return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
      status: 302,
    });
  }

  const email = userInfo.email;
  // userinfo v3 엔드포인트는 email_verified 를, 일부 구버전 응답은 verified_email 을 쓴다. 둘 다 확인한다.
  const verifiedEmail = userInfo.email_verified ?? userInfo.verified_email;

  if (!email) {
    console.warn('[auth] Google userinfo 에 이메일이 없습니다 — 세션을 발급하지 않습니다.');
    return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
      status: 302,
    });
  }

  if (verifiedEmail !== true) {
    console.warn(`[auth] 미인증 이메일 로그인 시도 거부: ${maskEmail(email)}`);
    return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
      status: 302,
    });
  }

  if (!isAllowedEmail(email, config.allowlist)) {
    console.warn(`[auth] 허용 목록 외 이메일 로그인 시도 거부: ${maskEmail(email)}`);
    return NextResponse.redirect(absoluteUrl(LOGIN_FAILURE_REDIRECT), {
      status: 302,
    });
  }

  // 성공 — JWT 발급 및 쿠키 설정
  const token = await signEditorJWT(email);
  const cookieOptions = await editorCookieOptions();

  // 쿠키는 **응답 객체에 직접** 실어야 한다.
  // Route Handler 에서 `cookies().set()` 후 별도로 만든 리다이렉트 응답을 반환하면
  // Set-Cookie 가 누락될 수 있고, 그러면 로그인해도 세션이 남지 않아 매번 재인증하게 된다.
  const response = NextResponse.redirect(absoluteUrl(returnTo), {
    status: 302,
  });
  response.cookies.set(COOKIE_NAME, token, cookieOptions);

  // 로그인 흐름 임시 쿠키 정리 (재사용 방지)
  response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
  response.cookies.delete(OAUTH_RETURN_TO_COOKIE_NAME);

  return response;
}
