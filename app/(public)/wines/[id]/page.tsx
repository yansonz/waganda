import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getWineDetailView } from '@/lib/views/read';
import { winePlaceParts } from '@/lib/domain/region';
import { WINE_TYPE_LABEL } from '@/lib/views/labels';
import { RatingTrend } from '@/components/wine/RatingTrend';
import { FitBadge } from '@/components/wine/FitBadge';
import { WineEditControls } from '@/components/wine/WineEditControls';
import { TastingCard } from '@/components/tasting/TastingCard';
import { EmptyState } from '@/components/common/EmptyState';

/**
 * app/(public)/wines/[id]/page.tsx — 와인 상세 (14.4).
 *
 * 시음 이력을 시간순으로, 평점 추이를 선 차트로 표시한다.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const repo = new DynamoDbRepository();
  const view = await getWineDetailView(repo, id);

  if (!view) {
    return { title: '와인을 찾을 수 없습니다' };
  }

  const title = `${view.wine.name}${view.wine.vintage ? ` ${view.wine.vintage}` : ''}`;
  const description = [
    view.winery?.name ?? view.wine.wineryName,
    winePlaceParts(view.wine, view.regionPath).join(' > '),
    `시음 ${view.tastingHistory.length}건`,
  ]
    .filter((part) => part !== undefined && part.length > 0)
    .join(' · ');

  return { title, description };
}

export default async function WineDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const repo = new DynamoDbRepository();
  const view = await getWineDetailView(repo, id);

  if (!view) {
    notFound();
  }

  const { wine, winery, regionPath, tastingHistory, ratingTrend, fit } = view;

  /*
   * 카탈로그 참조가 없는 와인(라벨 인식으로 만들어진 초안 등)도 산지·와이너리가 보이게 한다.
   * 참조가 있으면 참조 이름이 우선하고, 없으면 인식·검색으로 얻은 자유 텍스트를 쓴다.
   */
  const wineryLabel = winery?.name ?? wine.wineryName;
  const placeParts = winePlaceParts(wine, regionPath);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-cream-100">
            {wine.name}
            {wine.vintage && <span className="text-muted ml-2 text-lg">{wine.vintage}</span>}
          </h1>
          <p className="text-muted text-sm">
            {wineryLabel && <span>{wineryLabel}</span>}
            {placeParts.length > 0 && (
              <span className={wineryLabel ? 'ml-2' : undefined}>
                {wineryLabel && '· '}
                {placeParts.join(' > ')}
              </span>
            )}
          </p>
          {wine.grapes.length > 0 && (
            <p className="text-muted text-sm">품종: {wine.grapes.join(', ')}</p>
          )}
          {(wine.wineType || wine.alcoholPercent !== undefined) && (
            <p className="text-muted text-sm">
              {[
                wine.wineType ? (WINE_TYPE_LABEL[wine.wineType] ?? wine.wineType) : undefined,
                wine.alcoholPercent !== undefined ? `${wine.alcoholPercent}%` : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <div className="mt-2">
            <FitBadge level={fit} />
          </div>
        </div>
        <WineEditControls wineId={wine.id} wineName={wine.name} rev={wine.rev} />
      </header>

      <section aria-labelledby="rating-trend-heading">
        <h2 id="rating-trend-heading" className="font-display mb-2 text-lg text-cream-100">
          평점 추이
        </h2>
        <RatingTrend points={ratingTrend} />
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="font-display mb-2 text-lg text-cream-100">
          시음 이력
        </h2>
        {tastingHistory.length === 0 ? (
          <EmptyState title="이 와인의 시음 기록이 없습니다" />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tastingHistory.map((tasting) => (
              <li key={tasting.tastingId}>
                <TastingCard tasting={tasting} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
