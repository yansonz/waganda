/**
 * __tests__/lib/rss.test.ts — RSS 피드 빌더(lib/rss.ts) 단위 테스트.
 *
 * XML 이스케이핑, guid, pubDate, 링크 패턴이 스펙대로 나오는지 검증한다.
 */
import { describe, expect, it } from 'vitest';
import { buildRssFeed, escapeXml } from '@/lib/rss';
import type { TastingSummaryView } from '@/lib/views/read';

function makeTastingSummary(
  overrides: Partial<TastingSummaryView> & { tastingId: string },
): TastingSummaryView {
  return {
    wineId: 'wine-1',
    wineName: '테스트 와인',
    tastedAt: '2025-06-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('escapeXml', () => {
  it('앰퍼샌드·꺾쇠·인용부호를 XML 엔티티로 치환한다', () => {
    expect(escapeXml(`A & B <tag> "quoted" 'single'`)).toBe(
      'A &amp; B &lt;tag&gt; &quot;quoted&quot; &apos;single&apos;',
    );
  });

  it('특수문자가 없으면 그대로 반환한다', () => {
    expect(escapeXml('와인 이름')).toBe('와인 이름');
  });
});

describe('buildRssFeed', () => {
  it('채널 메타데이터(title·link·description)를 이스케이프해 포함한다', () => {
    const xml = buildRssFeed({
      title: '와간다 & 타임라인',
      description: '설명 <태그>',
      baseUrl: 'https://waganda.example.com',
      tastings: [],
    });

    expect(xml).toContain('<title>와간다 &amp; 타임라인</title>');
    expect(xml).toContain('<description>설명 &lt;태그&gt;</description>');
    expect(xml).toContain('<link>https://waganda.example.com</link>');
    expect(xml).toContain('<rss version="2.0">');
  });

  it('시음 항목을 /tastings/{id} 링크와 isPermaLink=false guid로 렌더링한다', () => {
    const xml = buildRssFeed({
      title: '타임라인',
      description: '설명',
      baseUrl: 'https://waganda.example.com',
      tastings: [makeTastingSummary({ tastingId: 't1', wineName: '바롤로', vintage: 2018 })],
    });

    expect(xml).toContain('<link>https://waganda.example.com/tastings/t1</link>');
    expect(xml).toContain('<guid isPermaLink="false">t1</guid>');
    expect(xml).toContain('<title>바롤로 2018</title>');
  });

  it('vintage 가 없으면 와인 이름만으로 title 을 만든다', () => {
    const xml = buildRssFeed({
      title: '타임라인',
      description: '설명',
      baseUrl: 'https://waganda.example.com',
      tastings: [makeTastingSummary({ tastingId: 't2', wineName: '샴페인' })],
    });

    expect(xml).toContain('<title>샴페인</title>');
  });

  it('tastedAt 을 RFC 1123 형식(pubDate)으로 변환한다', () => {
    const xml = buildRssFeed({
      title: '타임라인',
      description: '설명',
      baseUrl: 'https://waganda.example.com',
      tastings: [
        makeTastingSummary({ tastingId: 't3', tastedAt: '2025-06-01T12:00:00.000Z' }),
      ],
    });

    expect(xml).toContain(`<pubDate>${new Date('2025-06-01T12:00:00.000Z').toUTCString()}</pubDate>`);
  });

  it('summary 가 사용자/모델 생성 텍스트라도 이스케이프해서 description 에 넣는다', () => {
    const xml = buildRssFeed({
      title: '타임라인',
      description: '설명',
      baseUrl: 'https://waganda.example.com',
      tastings: [
        makeTastingSummary({
          tastingId: 't4',
          summary: '<script>alert(1)</script> & 좋았다',
        }),
      ],
    });

    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; 좋았다');
    expect(xml).not.toContain('<script>alert(1)</script>');
  });

  it('summary 가 없으면 빈 description 태그를 만든다', () => {
    const xml = buildRssFeed({
      title: '타임라인',
      description: '설명',
      baseUrl: 'https://waganda.example.com',
      tastings: [makeTastingSummary({ tastingId: 't5' })],
    });

    expect(xml).toContain('<description></description>');
  });

  it('여러 시음이 있으면 각각 별도 item 으로 렌더링한다', () => {
    const xml = buildRssFeed({
      title: '타임라인',
      description: '설명',
      baseUrl: 'https://waganda.example.com',
      tastings: [
        makeTastingSummary({ tastingId: 't6', wineName: '와인A' }),
        makeTastingSummary({ tastingId: 't7', wineName: '와인B' }),
      ],
    });

    expect(xml.match(/<item>/g)?.length).toBe(2);
    expect(xml).toContain('와인A');
    expect(xml).toContain('와인B');
  });
});
