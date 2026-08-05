import { DynamoDbRepository } from '@/lib/db/repository';
import { getTimelineView } from '@/lib/views/read';
import { getPublicBaseUrl } from '@/lib/config';
import { buildRssFeed, isRssEligibleTasting } from '@/lib/rss';

/**
 * app/feed.xml/route.ts — 타임라인 RSS 2.0 피드 (docs/issues/timeline-rss-feed-feasibility.md).
 *
 * - 최신순 상위 50개만 포함한다(전체 히스토리를 다 넣지 않음 — 결정 사항 #2).
 * - `<enclosure>`(라벨 사진)는 포함하지 않는다(결정 사항 #3, 미진행).
 * - CloudFront 캐시는 `/*` 무효화에 자동 포함되므로 시음 확정·편집자 쓰기 직후 갱신된다
 *   (`lib/cache/invalidate.ts`, `agent/src/graph/nodes/persistAndPublish.ts`).
 */
export const dynamic = 'force-dynamic';

const FEED_ITEM_LIMIT = 50;

export async function GET(): Promise<Response> {
  const repo = new DynamoDbRepository();
  const tastings = await getTimelineView(repo);
  const baseUrl = getPublicBaseUrl();

  const xml = buildRssFeed({
    title: '와간다 — 타임라인',
    description: '날짜순으로 모든 시음 기록을 되짚어봅니다',
    baseUrl,
    tastings: tastings.filter(isRssEligibleTasting).slice(0, FEED_ITEM_LIMIT),
  });

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
}
