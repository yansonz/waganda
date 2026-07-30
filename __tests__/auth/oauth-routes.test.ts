// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * OAuth 라우트(start/callback) 통합 테스트.
 * Google 토큰/userinfo 호출은 vi.stubGlobal('fetch', ...) 로 대체한다. 실제 네트워크 호출 없음.
 */

const cookieStore = new Map<string, { value: string }>();

/**
 * 응답의 실제 Set-Cookie 헤더를 읽는다.
 *
 * 과거 이 테스트들이 목(mock) 쿠키 저장소만 검증해서,
 * 리다이렉트 응답에 Set-Cookie 가 실리지 않는 결함(로그인해도 세션이 남지 않음)을
 * 잡지 못했다. 이제 브라우저가 실제로 받는 헤더를 단정한다.
 */
function setCookieHeaders(response: Response): string[] {
  const getAll = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getAll === 'function') return getAll.call(response.headers);
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

function cookieValueFrom(response: Response, name: string): string | undefined {
  const header = setCookieHeaders(response).find((c) => c.startsWith(`${name}=`));
  if (!header) return undefined;
  return decodeURIComponent(header.slice(name.length + 1).split(';')[0]);
}

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: vi.fn((name: string, value: string) => {
      cookieStore.set(name, { value });
    }),
    delete: vi.fn((name: string) => {
      cookieStore.delete(name);
    }),
  })),
}));

import { GET as startGoogleAuth } from '@/app/api/auth/google/start/route';
import { GET as googleCallback } from '@/app/api/auth/google/callback/route';
import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_RETURN_TO_COOKIE_NAME,
  COOKIE_NAME,
} from '@/lib/auth/session';

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'https://waganda.test'));
}

describe('GET /api/auth/google/start', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('state 쿠키를 저장하고 Google 인증 화면으로 302 리다이렉트한다', async () => {
    const request = makeRequest('https://waganda.test/api/auth/google/start?returnTo=/record');
    const response = await startGoogleAuth(request);

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('accounts.google.com');

    // 브라우저가 실제로 받는 Set-Cookie 를 확인한다
    expect(cookieValueFrom(response, OAUTH_STATE_COOKIE_NAME)).toBeTruthy();
    expect(cookieValueFrom(response, OAUTH_RETURN_TO_COOKIE_NAME)).toBe('/record');
  });

  it('returnTo 가 절대 URL 이면 거부하고 기본 경로로 대체한다 (오픈 리다이렉트 방지)', async () => {
    const request = makeRequest(
      'https://waganda.test/api/auth/google/start?returnTo=' +
        encodeURIComponent('https://evil.example.com/phish'),
    );
    const response = await startGoogleAuth(request);
    expect(cookieValueFrom(response, OAUTH_RETURN_TO_COOKIE_NAME)).toBe('/');
  });

  it("returnTo 가 '//' 로 시작하면 거부하고 기본 경로로 대체한다 (프로토콜 상대 URL 오픈 리다이렉트 방지)", async () => {
    const request = makeRequest(
      'https://waganda.test/api/auth/google/start?returnTo=' +
        encodeURIComponent('//evil.example.com'),
    );
    const response = await startGoogleAuth(request);
    expect(cookieValueFrom(response, OAUTH_RETURN_TO_COOKIE_NAME)).toBe('/');
  });

  it('returnTo 가 javascript: 스킴이면 거부한다', async () => {
    const request = makeRequest(
      'https://waganda.test/api/auth/google/start?returnTo=' +
        encodeURIComponent('javascript:alert(1)'),
    );
    const response = await startGoogleAuth(request);
    expect(cookieValueFrom(response, OAUTH_RETURN_TO_COOKIE_NAME)).toBe('/');
  });

  it('returnTo 가 없으면 기본 경로를 사용한다', async () => {
    const request = makeRequest('https://waganda.test/api/auth/google/start');
    const response = await startGoogleAuth(request);
    expect(cookieValueFrom(response, OAUTH_RETURN_TO_COOKIE_NAME)).toBe('/');
  });

  it('내부 경로 returnTo 는 그대로 허용한다', async () => {
    const request = makeRequest(
      'https://waganda.test/api/auth/google/start?returnTo=' +
        encodeURIComponent('/tastings/abc123'),
    );
    const response = await startGoogleAuth(request);
    expect(cookieValueFrom(response, OAUTH_RETURN_TO_COOKIE_NAME)).toBe('/tastings/abc123');
  });
});

describe('GET /api/auth/google/callback', () => {
  beforeEach(() => {
    cookieStore.clear();
    cookieStore.set(OAUTH_STATE_COOKIE_NAME, { value: 'valid-state-value' });
    cookieStore.set(OAUTH_RETURN_TO_COOKIE_NAME, { value: '/record' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchSuccess(email: string, verified = true): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'fake-access-token',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(JSON.stringify({ email, email_verified: verified }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch call: ${urlStr}`);
      }),
    );
  }

  it('state 불일치 시 세션을 발급하지 않는다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetchSuccess('yan@example.com');

    const request = makeRequest(
      'https://waganda.test/api/auth/google/callback?code=abc&state=WRONG_STATE',
    );
    const response = await googleCallback(request);

    expect(response.status).toBe(302);
    expect(cookieStore.has(COOKIE_NAME)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('code 가 없으면 세션을 발급하지 않는다', async () => {
    const request = makeRequest(
      'https://waganda.test/api/auth/google/callback?state=valid-state-value',
    );
    const response = await googleCallback(request);
    expect(response.status).toBe(302);
    expect(cookieStore.has(COOKIE_NAME)).toBe(false);
  });

  it('verified_email 이 false 면 세션을 발급하지 않는다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetchSuccess('yan@example.com', false);

    const request = makeRequest(
      'https://waganda.test/api/auth/google/callback?code=abc&state=valid-state-value',
    );
    const response = await googleCallback(request);

    expect(response.status).toBe(302);
    expect(cookieStore.has(COOKIE_NAME)).toBe(false);
    warnSpy.mockRestore();
  });

  it('허용 목록 외 이메일이면 세션을 발급하지 않고 시도를 기록한다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetchSuccess('stranger@example.com', true);

    const request = makeRequest(
      'https://waganda.test/api/auth/google/callback?code=abc&state=valid-state-value',
    );
    const response = await googleCallback(request);

    expect(response.status).toBe(302);
    expect(cookieStore.has(COOKIE_NAME)).toBe(false);

    // 이메일 전체가 아닌 마스킹된 형태로 기록되어야 한다
    const loggedMessages = warnSpy.mock.calls.map((call) => call.join(' '));
    const hasFullEmail = loggedMessages.some((msg) => msg.includes('stranger@example.com'));
    expect(hasFullEmail).toBe(false);
    warnSpy.mockRestore();
  });

  it('허용 목록에 있고 verified_email 이 true 면 세션을 발급하고 returnTo 로 리다이렉트한다', async () => {
    stubFetchSuccess('yan@example.com', true);

    const request = makeRequest(
      'https://waganda.test/api/auth/google/callback?code=abc&state=valid-state-value',
    );
    const response = await googleCallback(request);

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('/record');

    // 리다이렉트 응답에 세션 쿠키가 실제로 실려야 한다
    // (실리지 않으면 로그인해도 세션이 남지 않아 매번 재인증하게 된다)
    const sessionCookie = setCookieHeaders(response).find((c) => c.startsWith(`${COOKIE_NAME}=`));
    expect(sessionCookie, 'Set-Cookie 에 세션 쿠키가 없다').toBeTruthy();
    expect(sessionCookie).toMatch(/httponly/i);
    expect(sessionCookie).toMatch(/samesite=lax/i);
    expect(sessionCookie).toMatch(/path=\//i);
    // 테스트 환경의 APP_BASE_URL 은 https 이므로 Secure 가 붙어야 한다
    expect(sessionCookie).toMatch(/secure/i);
    // 발급된 토큰이 곧바로 검증을 통과해야 한다
    const token = cookieValueFrom(response, COOKIE_NAME);
    expect(token?.split('.')).toHaveLength(3);

    // 로그인 흐름 임시 쿠키는 정리된다 (재사용 방지)
    const cleared = setCookieHeaders(response).filter((c) =>
      c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`),
    );
    expect(cleared.length).toBeGreaterThan(0);
  });

  it('토큰 교환 실패(non-2xx) 시 세션을 발급하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('error', { status: 400 })),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const request = makeRequest(
      'https://waganda.test/api/auth/google/callback?code=abc&state=valid-state-value',
    );
    const response = await googleCallback(request);

    expect(response.status).toBe(302);
    expect(cookieStore.has(COOKIE_NAME)).toBe(false);
    warnSpy.mockRestore();
  });

  it('state 사용 후 재사용을 막기 위해 state/returnTo 쿠키를 정리한다', async () => {
    stubFetchSuccess('yan@example.com', true);
    const request = makeRequest(
      'https://waganda.test/api/auth/google/callback?code=abc&state=valid-state-value',
    );
    await googleCallback(request);
    expect(cookieStore.has(OAUTH_STATE_COOKIE_NAME)).toBe(false);
    expect(cookieStore.has(OAUTH_RETURN_TO_COOKIE_NAME)).toBe(false);
  });
});
