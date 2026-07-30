/**
 * 세션 쿠키의 `Secure` 속성 회귀 테스트.
 *
 * 배경: `Secure` 를 무조건 붙이면 로컬(http)에서 브라우저가 쿠키를 저장하지 않아
 * 로그인해도 세션이 남지 않고 **쓰기 버튼을 누를 때마다 다시 구글 인증**을 하게 된다.
 * 그래서 `APP_BASE_URL` 이 http 일 때만 Secure 를 빼고, https 에서는 반드시 붙인다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editorCookieOptions, oauthFlowCookieOptions } from '@/lib/auth/session';

const ORIGINAL_BASE = process.env.APP_BASE_URL;

beforeEach(() => {
  delete process.env.APP_BASE_URL;
});

afterEach(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = ORIGINAL_BASE;
});

describe('쿠키 Secure 속성', () => {
  it('https 베이스 URL 이면 Secure 를 붙인다', async () => {
    process.env.APP_BASE_URL = 'https://waganda.yanbert.com';
    expect((await editorCookieOptions()).secure).toBe(true);
    expect(oauthFlowCookieOptions().secure).toBe(true);
  });

  it('로컬 http 베이스 URL 이면 Secure 를 붙이지 않는다', async () => {
    for (const base of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      process.env.APP_BASE_URL = base;
      expect((await editorCookieOptions()).secure, base).toBe(false);
      expect(oauthFlowCookieOptions().secure, base).toBe(false);
    }
  });

  it('베이스 URL 을 알 수 없으면 안전한 쪽(Secure 부여)을 택한다', async () => {
    process.env.APP_BASE_URL = '';
    expect(oauthFlowCookieOptions().secure).toBe(true);
  });

  it('HttpOnly·SameSite=Lax·path 는 환경과 무관하게 유지한다', async () => {
    process.env.APP_BASE_URL = 'http://localhost:3000';
    const options = await editorCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBeGreaterThan(0);
  });
});
