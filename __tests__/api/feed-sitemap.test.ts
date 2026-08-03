// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDocClient, setDocClient } from '@/lib/db/client';

/**
 * __tests__/api/feed-sitemap.test.ts — app/feed.xml, app/sitemap.ts 스모크 테스트.
 *
 * DynamoDB 는 `setDocClient` 스텁으로 대체하고, 모든 쿼리가 빈 결과를 반환하는
 * "레코드 0건" 상태에서 각 라우트가 예외 없이 올바른 형식으로 응답하는지 검증한다.
 * 데이터가 있는 경로의 조합 로직(제목·링크·guid 등)은 `__tests__/lib/rss.test.ts` 와
 * `__tests__/views/read.test.ts` 가 이미 고정한다.
 */

function createEmptyDocClient() {
  return { send: vi.fn().mockResolvedValue({ Items: [], Item: undefined }) };
}

describe('GET /feed.xml', () => {
  beforeEach(() => {
    setDocClient(createEmptyDocClient() as never);
  });

  afterEach(() => {
    resetDocClient();
  });

  it('레코드가 없어도 RSS 2.0 형식의 유효한 빈 채널을 반환한다', async () => {
    const { GET } = await import('@/app/feed.xml/route');
    const response = await GET();

    expect(response.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    const xml = await response.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<channel>');
    expect(xml).not.toContain('<item>');
  });
});

describe('sitemap()', () => {
  beforeEach(() => {
    setDocClient(createEmptyDocClient() as never);
  });

  afterEach(() => {
    resetDocClient();
  });

  it('레코드가 없어도 정적 경로만 포함한 사이트맵을 반환한다', async () => {
    const sitemap = (await import('@/app/sitemap')).default;
    const entries = await sitemap();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => typeof entry.url === 'string' && entry.url.length > 0)).toBe(
      true,
    );
    expect(entries.some((entry) => entry.url.endsWith('/timeline'))).toBe(true);
  });
});
