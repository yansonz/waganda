/**
 * lib/rss.ts — RSS 2.0 피드 생성 순수 함수 (`app/feed.xml/route.ts` 가 사용).
 *
 * XML 이스케이핑과 마크업 조립을 라우트 핸들러에서 분리해 단위 테스트를 붙일 수 있게 한다.
 * `wineName`·`summary` 는 사용자/모델 생성 텍스트이므로 `&`, `<`, `>` 등을 반드시 이스케이프한다.
 */
import type { TastingSummaryView } from '@/lib/views/read';

/** XML 텍스트 노드에 안전하게 넣기 위한 최소 이스케이프 (RSS 는 XML 1.0 서브셋) */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface RssFeedInput {
  /** 채널 타이틀 */
  title: string;
  /** 채널 설명 */
  description: string;
  /** 표기용 절대 베이스 URL (trailing slash 없음) */
  baseUrl: string;
  /** 최신순으로 정렬된 시음 목록. 함수 내부에서 개수를 자르지 않는다 — 호출측이 slice 해서 넘긴다 */
  tastings: TastingSummaryView[];
}

/**
 * RSS는 사진/와인 정보와 음성 분석이 모두 완성된 공개 기록만 내보낸다.
 * lifecycle은 getTimelineView의 공개 필터에서 이미 보장하며, 여기서는 피드 고유 입력을 확인한다.
 */
export function isRssEligibleTasting(tasting: TastingSummaryView): boolean {
  return Boolean(tasting.labelImageKey && tasting.summary);
}

/** 시음 한 건을 RSS `<item>` 하나로 변환 */
function buildItem(tasting: TastingSummaryView, baseUrl: string): string {
  const link = `${baseUrl}/tastings/${tasting.tastingId}`;
  const titleParts = [tasting.wineName, tasting.vintage ? String(tasting.vintage) : undefined]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const pubDate = new Date(tasting.tastedAt).toUTCString();
  const description = tasting.summary ?? '';

  return [
    '    <item>',
    `      <title>${escapeXml(titleParts)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(tasting.tastingId)}</guid>`,
    `      <pubDate>${pubDate}</pubDate>`,
    `      <description>${escapeXml(description)}</description>`,
    '    </item>',
  ].join('\n');
}

/** RSS 2.0 문서 전체 조립 */
export function buildRssFeed(input: RssFeedInput): string {
  const channelLink = input.baseUrl;
  const items = input.tastings.map((tasting) => buildItem(tasting, input.baseUrl)).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXml(input.title)}</title>`,
    `    <link>${escapeXml(channelLink)}</link>`,
    `    <description>${escapeXml(input.description)}</description>`,
    items,
    '  </channel>',
    '</rss>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}
