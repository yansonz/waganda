// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * lib/auth/session.ts 단위 테스트.
 *
 * next/headers 의 cookies() 는 Next 15 에서 async 이므로 vi.mock 으로 대체한다.
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

import {
  signEditorJWT,
  verifyEditorJWT,
  getEditorSession,
  requireEditor,
  isAllowedEmail,
  editorCookieOptions,
  oauthFlowCookieOptions,
  UnauthorizedError,
  COOKIE_NAME,
} from '@/lib/auth/session';

describe('isAllowedEmail', () => {
  const allowlist = ['yan@example.com', 'robert@example.com'];

  it('허용 목록에 있는 이메일을 허용한다', () => {
    expect(isAllowedEmail('yan@example.com', allowlist)).toBe(true);
  });

  it('대소문자를 무시하고 비교한다', () => {
    expect(isAllowedEmail('YAN@EXAMPLE.COM', allowlist)).toBe(true);
  });

  it('앞뒤 공백을 trim 하고 비교한다', () => {
    expect(isAllowedEmail('  yan@example.com  ', allowlist)).toBe(true);
  });

  it('허용 목록 외 이메일은 거부한다', () => {
    expect(isAllowedEmail('stranger@example.com', allowlist)).toBe(false);
  });
});

describe('signEditorJWT / verifyEditorJWT', () => {
  it('허용 목록에 있는 이메일로 서명한 JWT 는 유효하다', async () => {
    const token = await signEditorJWT('yan@example.com');
    const session = await verifyEditorJWT(token);
    expect(session).not.toBeNull();
    expect(session?.email).toBe('yan@example.com');
  });

  it('이메일을 소문자로 정규화해 서명한다', async () => {
    const token = await signEditorJWT('YAN@EXAMPLE.COM');
    const session = await verifyEditorJWT(token);
    expect(session?.email).toBe('yan@example.com');
  });

  it('허용 목록 외 이메일의 유효한 서명 JWT 는 무효로 처리한다 (매 요청 재검증)', async () => {
    // 허용 목록에 없는 이메일도 서명 자체는 가능하다 — signEditorJWT 는 허용 목록을 검사하지 않는다.
    // 검증(verifyEditorJWT) 시점에 재검증되어야 한다.
    const token = await signEditorJWT('stranger@example.com');
    const session = await verifyEditorJWT(token);
    expect(session).toBeNull();
  });

  it('허용 목록에서 이후 제외된 이메일의 기존 유효 토큰은 무효로 처리한다', async () => {
    // 발급 시점엔 허용되었지만, 검증 시점에 목록이 바뀐 상황을 재현한다.
    const token = await signEditorJWT('yan@example.com');

    const originalAllowlist = process.env.EDITOR_ALLOWLIST;
    process.env.EDITOR_ALLOWLIST = 'robert@example.com'; // yan 제외
    vi.resetModules();

    try {
      const { verifyEditorJWT: verifyAfterRemoval } = await import('@/lib/auth/session');
      const session = await verifyAfterRemoval(token);
      expect(session).toBeNull();
    } finally {
      process.env.EDITOR_ALLOWLIST = originalAllowlist;
      vi.resetModules();
    }
  });

  it('만료된 JWT 는 무효로 처리한다', async () => {
    process.env.EDITOR_SESSION_TTL_SEC = '-1'; // 즉시 만료
    vi.resetModules();
    try {
      const { signEditorJWT: signExpired, verifyEditorJWT: verifyExpired } =
        await import('@/lib/auth/session');
      const token = await signExpired('yan@example.com');
      const session = await verifyExpired(token);
      expect(session).toBeNull();
    } finally {
      delete process.env.EDITOR_SESSION_TTL_SEC;
      vi.resetModules();
    }
  });

  it('형식이 잘못된 토큰은 무효로 처리한다', async () => {
    const session = await verifyEditorJWT('not-a-valid-jwt');
    expect(session).toBeNull();
  });

  it('다른 시크릿으로 서명된 토큰은 무효로 처리한다', async () => {
    process.env.EDITOR_JWT_SECRET = 'a-completely-different-secret-value-32bytes!!';
    vi.resetModules();
    let tamperedToken: string;
    try {
      const { signEditorJWT: signWithDifferentSecret } = await import('@/lib/auth/session');
      tamperedToken = await signWithDifferentSecret('yan@example.com');
    } finally {
      process.env.EDITOR_JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-bytes-long!!';
      vi.resetModules();
    }
    const { verifyEditorJWT: verifyWithOriginalSecret } = await import('@/lib/auth/session');
    const session = await verifyWithOriginalSecret(tamperedToken);
    expect(session).toBeNull();
  });
});

describe('getEditorSession / requireEditor', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('쿠키가 없으면 null 을 반환한다', async () => {
    const session = await getEditorSession();
    expect(session).toBeNull();
  });

  it('유효한 쿠키가 있으면 세션을 반환한다', async () => {
    const token = await signEditorJWT('robert@example.com');
    cookieStore.set(COOKIE_NAME, { value: token });
    const session = await getEditorSession();
    expect(session?.email).toBe('robert@example.com');
  });

  it('세션이 없으면 requireEditor 가 UnauthorizedError 를 던진다', async () => {
    await expect(requireEditor()).rejects.toThrow(UnauthorizedError);
  });

  it('세션이 있으면 requireEditor 가 세션을 반환한다', async () => {
    const token = await signEditorJWT('yan@example.com');
    cookieStore.set(COOKIE_NAME, { value: token });
    const session = await requireEditor();
    expect(session.email).toBe('yan@example.com');
  });
});

describe('editorCookieOptions', () => {
  it('HttpOnly, Secure, SameSite=Lax, path=/ 를 설정한다', async () => {
    const options = await editorCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBeGreaterThan(0);
  });
});

describe('oauthFlowCookieOptions', () => {
  it('HttpOnly, Secure, SameSite=Lax 를 설정한다', () => {
    const options = oauthFlowCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
  });
});
