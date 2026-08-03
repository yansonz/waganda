// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * __tests__/api/robots.test.ts — app/robots.ts 회귀 테스트.
 *
 * `dynamic = 'force-dynamic'` 이 빠지면 Docker 이미지 빌드 시점(APP_BASE_URL 미주입)에
 * robots.txt 의 sitemap 필드가 `http://localhost:3000/sitemap.xml` 로 정적으로 굳어버린다
 * (실제 배포에서 재현됐던 결함). 런타임에 APP_BASE_URL 을 반영하는지를 검증한다.
 */
describe('robots()', () => {
  const originalBaseUrl = process.env.APP_BASE_URL;

  beforeEach(() => {
    process.env.APP_BASE_URL = 'https://waganda.example.com';
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = originalBaseUrl;
    }
  });

  it('force-dynamic 을 export 해 빌드 시점 정적 생성을 막는다', async () => {
    const mod = await import('@/app/robots');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('APP_BASE_URL 런타임 값을 sitemap 필드에 반영한다', async () => {
    const robots = (await import('@/app/robots')).default;
    const result = robots();
    expect(result.sitemap).toBe('https://waganda.example.com/sitemap.xml');
  });

  it('쓰기 API·인증·기록 화면을 disallow 목록에 포함한다', async () => {
    const robots = (await import('@/app/robots')).default;
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules?.disallow).toEqual(
      expect.arrayContaining(['/api/auth', '/api/tastings', '/record']),
    );
  });
});
