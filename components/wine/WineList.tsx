import type { ReactElement } from 'react';
import Link from 'next/link';
import { Rating } from '@/components/common/Rating';
import { EmptyState } from '@/components/common/EmptyState';
import type { WineListItemView } from '@/lib/views/read';

/**
 * components/wine/WineList.tsx — 와인 목록 카드 그리드 (14.4).
 */
interface WineListProps {
  wines: WineListItemView[];
}

export function WineList({ wines }: WineListProps): ReactElement {
  if (wines.length === 0) {
    return <EmptyState title="와인이 없습니다" description="아직 등록된 와인이 없어요." />;
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {wines.map((wine) => {
        /*
         * 산지는 국가와 지역을 한 줄로 합쳐 보여준다.
         * 카탈로그 지역 참조가 없는 와인(라벨 인식 초안 등)은 regionName 이 비어 있는데,
         * 이때 국가마저 숨기면 카드에 이름과 평점만 남아 어떤 와인인지 알 수 없다.
         */
        const place = [wine.country, wine.regionName].filter(
          (part): part is string => typeof part === 'string' && part.length > 0,
        );
        return (
          <li key={wine.wineId}>
            <Link
              href={`/wines/${wine.wineId}`}
              className="card block h-full p-4 hover:border-gold-500/40"
            >
              <p className="font-display text-cream-100">
                {wine.name}
                {wine.vintage && <span className="text-muted ml-1 text-sm">{wine.vintage}</span>}
                {wine.draft && (
                  // 라벨 인식으로 자동 생성된 뒤 아직 확인되지 않은 와인
                  <span className="ml-2 rounded border border-gold-500/40 px-1.5 py-0.5 text-xs text-gold-300">
                    확인 필요
                  </span>
                )}
              </p>
              {wine.wineryName && <p className="text-muted text-sm">{wine.wineryName}</p>}
              {place.length > 0 && (
                <p className="text-muted text-sm">{[...new Set(place)].join(' > ')}</p>
              )}
              {wine.grapes.length > 0 && (
                <p className="text-muted text-sm">품종: {wine.grapes.join(', ')}</p>
              )}
              <div className="mt-2 flex items-center justify-between">
                {wine.meanRating !== undefined ? (
                  <Rating value={wine.meanRating} />
                ) : (
                  <span className="text-muted text-sm">평점 없음</span>
                )}
                <span className="text-muted text-sm">시음 {wine.tastingCount}회</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
