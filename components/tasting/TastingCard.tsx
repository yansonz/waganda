import Link from 'next/link';
import type { ReactElement } from 'react';
import { Rating } from '@/components/common/Rating';
import type { TastingSummaryView } from '@/lib/views/read';
import { SERVICE_TIME_ZONE } from '@/lib/domain/types';

/**
 * components/tasting/TastingCard.tsx — 시음 요약 카드 (대시보드·타임라인·와인 상세 공용).
 */
interface TastingCardProps {
  tasting: TastingSummaryView;
}

export function TastingCard({ tasting }: TastingCardProps): ReactElement {
  const dateLabel = new Date(tasting.tastedAt).toLocaleDateString('ko-KR', {
    timeZone: SERVICE_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Link
      href={`/tastings/${tasting.tastingId}`}
      className="card block p-4 transition-colors hover:border-gold-500/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-cream-100">
            {tasting.wineName}
            {tasting.vintage && <span className="text-muted ml-1 text-sm">{tasting.vintage}</span>}
          </p>
          <time dateTime={tasting.tastedAt} className="text-muted text-sm">
            {dateLabel}
          </time>
        </div>
        {tasting.displayRating !== undefined && (
          <Rating
            value={tasting.displayRating}
            label={tasting.ratingSource === 'manual' ? '수동 평점' : 'AI 평점'}
          />
        )}
      </div>
      {tasting.summary && (
        <p className="text-cream-200 mt-2 line-clamp-2 text-sm">{tasting.summary}</p>
      )}
    </Link>
  );
}
