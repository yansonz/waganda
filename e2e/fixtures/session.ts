import { SignJWT } from 'jose';
import type { BrowserContext } from '@playwright/test';

/**
 * e2e/fixtures/session.ts — 편집자 세션 쿠키 주입.
 *
 * 실제 Google 로그인은 E2E 에서 재현할 수 없으므로(외부 의존),
 * 앱과 **동일한 형식**의 세션 JWT 를 서명해 쿠키로 심는다.
 * 값은 playwright.config.ts 의 webServer env 와 일치해야 한다.
 */
const COOKIE_NAME = 'waganda_editor_session';
const JWT_SECRET = 'local-jwt-secret-must-be-at-least-32-bytes-long!!';
const ALLOWED_EMAIL = 'yan@example.com';

/** 편집자 세션 쿠키를 컨텍스트에 심는다 */
export async function loginAsEditor(context: BrowserContext, email = ALLOWED_EMAIL): Promise<void> {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(new TextEncoder().encode(JWT_SECRET));

  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      // 로컬 http — Secure 를 붙이면 브라우저가 저장하지 않는다
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}
