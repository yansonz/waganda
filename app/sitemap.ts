import type { MetadataRoute } from 'next';
import type { Winery } from '@waganda/schemas';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getTimelineView, getWineListView } from '@/lib/views/read';
import { getPublicBaseUrl } from '@/lib/config';

/**
 * app/sitemap.ts — 사이트맵 생성 (`app/robots.ts` 가 이미 `${baseUrl}/sitemap.xml` 을 참조).
 *
 * 정적 공개 경로 + 시음/와인/와이너리 상세 같은 동적 경로를 모두 포함한다.
 * 인증·쓰기 API·`/record` 는 robots.txt 에서도 제외된 비공개 대상이라 여기 넣지 않는다.
 */
export const dynamic = 'force-dynamic';

const STATIC_PATHS: { path: string; priority: number }[] = [
  { path: '/', priority: 1 },
  { path: '/timeline', priority: 0.8 },
  { path: '/wines', priority: 0.6 },
  { path: '/discoveries', priority: 0.5 },
  { path: '/rankings', priority: 0.5 },
  { path: '/explore', priority: 0.4 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicBaseUrl();
  const repo = new DynamoDbRepository();

  const [tastings, wines, { items: wineries }] = await Promise.all([
    getTimelineView(repo),
    getWineListView(repo),
    repo.listByType<Winery>('WINERY', 'asc'),
  ]);

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map(({ path, priority }) => ({
    url: `${baseUrl}${path}`,
    priority,
  }));

  const tastingEntries: MetadataRoute.Sitemap = tastings.map((tasting) => ({
    url: `${baseUrl}/tastings/${tasting.tastingId}`,
    lastModified: tasting.tastedAt,
    priority: 0.7,
  }));

  const wineEntries: MetadataRoute.Sitemap = wines.map((wine) => ({
    url: `${baseUrl}/wines/${wine.wineId}`,
    priority: 0.6,
  }));

  const wineryEntries: MetadataRoute.Sitemap = wineries.map((winery) => ({
    url: `${baseUrl}/wineries/${winery.id}`,
    priority: 0.4,
  }));

  return [...staticEntries, ...tastingEntries, ...wineEntries, ...wineryEntries];
}
