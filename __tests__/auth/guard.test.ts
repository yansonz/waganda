// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * lib/auth/guard.ts 단위 테스트.
 */

const cookieStore = new Map<string, { value: string }>();

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

import { signEditorJWT, COOKIE_NAME } from '@/lib/auth/session';
import {
  requireEditorOr401,
  assertSameOrigin,
  withEditorGuard,
  toErrorResponse,
  ForbiddenError,
} from '@/lib/auth/guard';
import { UnauthorizedError } from '@/lib/auth/session';

function makeRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
): NextRequest {
  return new NextRequest(new URL(url, 'https://waganda.test'), {
    method: init?.method ?? 'GET',
    headers: init?.headers,
  });
}

describe('requireEditorOr401', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('세션이 없으면 401 과 loginUrl 을 포함한 응답을 반환한다', async () => {
    const request = makeRequest('https://waganda.test/api/tastings?foo=bar', { method: 'POST' });
    const result = await requireEditorOr401(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.loginUrl).toContain('/api/auth/google/start?returnTo=');
    expect(body.loginUrl).toContain(encodeURIComponent('/api/tastings?foo=bar'));
  });

  it('유효한 세션이 있으면 EditorSession 을 반환한다', async () => {
    const token = await signEditorJWT('yan@example.com');
    cookieStore.set(COOKIE_NAME, { value: token });

    const request = makeRequest('https://waganda.test/api/tastings', { method: 'POST' });
    const result = await requireEditorOr401(request);

    expect(result).not.toBeInstanceOf(NextResponse);
    const session = result as { email: string };
    expect(session.email).toBe('yan@example.com');
  });

  it('허용 목록 외 이메일의 유효 서명 JWT 는 401 로 처리한다', async () => {
    const token = await signEditorJWT('stranger@example.com');
    cookieStore.set(COOKIE_NAME, { value: token });

    const request = makeRequest('https://waganda.test/api/tastings', { method: 'POST' });
    const result = await requireEditorOr401(request);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });
});

describe('assertSameOrigin', () => {
  it('GET 요청은 Origin 검증 대상이 아니다', () => {
    const request = makeRequest('https://waganda.test/api/wines', { method: 'GET' });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it('POST 요청에 Origin 이 APP_BASE_URL 과 같으면 통과한다', () => {
    const request = makeRequest('https://waganda.test/api/wines', {
      method: 'POST',
      headers: { origin: 'https://waganda.test' },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it('POST 요청에 Origin 이 다르면 ForbiddenError 를 던진다', () => {
    const request = makeRequest('https://waganda.test/api/wines', {
      method: 'POST',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(() => assertSameOrigin(request)).toThrow(ForbiddenError);
  });

  it('POST 요청에 Origin 헤더가 없으면 거부한다', () => {
    const request = makeRequest('https://waganda.test/api/wines', { method: 'POST' });
    expect(() => assertSameOrigin(request)).toThrow(ForbiddenError);
  });

  it('DELETE 요청에도 Origin 검증이 적용된다', () => {
    const request = makeRequest('https://waganda.test/api/wines/1', {
      method: 'DELETE',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(() => assertSameOrigin(request)).toThrow(ForbiddenError);
  });
});

describe('toErrorResponse', () => {
  it('UnauthorizedError 를 401 응답으로 변환한다', async () => {
    const request = makeRequest('https://waganda.test/api/wines');
    const response = toErrorResponse(new UnauthorizedError(), request);
    expect(response?.status).toBe(401);
    const body = await response?.json();
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.loginUrl).toBeDefined();
  });

  it('ForbiddenError 를 403 응답으로 변환한다', async () => {
    const request = makeRequest('https://waganda.test/api/wines');
    const response = toErrorResponse(new ForbiddenError('테스트'), request);
    expect(response?.status).toBe(403);
  });

  it('알 수 없는 에러는 null 을 반환한다', () => {
    const request = makeRequest('https://waganda.test/api/wines');
    const response = toErrorResponse(new Error('알 수 없는 오류'), request);
    expect(response).toBeNull();
  });
});

describe('withEditorGuard', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('세션 없음 + POST → 401 (Origin 검증보다 먼저 402 는 없고 Origin 이 유효해야 세션 검증까지 도달)', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const guarded = withEditorGuard(handler);

    const request = makeRequest('https://waganda.test/api/tastings', {
      method: 'POST',
      headers: { origin: 'https://waganda.test' },
    });
    const response = await guarded(request);

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('잘못된 Origin 이면 403 을 반환하고 핸들러를 호출하지 않는다', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const guarded = withEditorGuard(handler);

    const token = await signEditorJWT('yan@example.com');
    cookieStore.set(COOKIE_NAME, { value: token });

    const request = makeRequest('https://waganda.test/api/tastings', {
      method: 'POST',
      headers: { origin: 'https://evil.example.com' },
    });
    const response = await guarded(request);

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('유효한 세션 + 동일 Origin 이면 핸들러를 호출하고 세션을 전달한다', async () => {
    const handler = vi.fn(async (_req, { session }) => NextResponse.json({ email: session.email }));
    const guarded = withEditorGuard(handler);

    const token = await signEditorJWT('robert@example.com');
    cookieStore.set(COOKIE_NAME, { value: token });

    const request = makeRequest('https://waganda.test/api/tastings', {
      method: 'POST',
      headers: { origin: 'https://waganda.test' },
    });
    const response = await guarded(request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const body = await response.json();
    expect(body.email).toBe('robert@example.com');
  });
});
