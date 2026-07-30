import type { ReactElement } from 'react';
import type { RatingTrendPoint } from '@/lib/views/read';

/**
 * components/wine/RatingTrend.tsx — 와인 상세 평점 추이 선 차트 (순수 SVG, 14.4).
 */
interface RatingTrendProps {
  points: RatingTrendPoint[];
  width?: number;
  height?: number;
}

const PADDING = 28;
const MIN_RATING = 1;
const MAX_RATING = 5;

export function RatingTrend({ points, width = 480, height = 160 }: RatingTrendProps): ReactElement {
  if (points.length === 0) {
    return (
      <p role="status" className="text-muted text-sm">
        평점 추이 데이터가 없습니다.
      </p>
    );
  }

  const innerWidth = width - PADDING * 2;
  const innerHeight = height - PADDING * 2;

  const toX = (index: number): number =>
    points.length === 1
      ? PADDING + innerWidth / 2
      : PADDING + (index / (points.length - 1)) * innerWidth;
  const toY = (rating: number): number =>
    PADDING + innerHeight - ((rating - MIN_RATING) / (MAX_RATING - MIN_RATING)) * innerHeight;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.rating).toFixed(1)}`)
    .join(' ');

  const describedId = 'rating-trend-desc';

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-labelledby={describedId}
      >
        <title id={describedId}>시음 기록의 평점 추이 그래프</title>
        {[1, 2, 3, 4, 5].map((level) => (
          <line
            key={level}
            x1={PADDING}
            y1={toY(level)}
            x2={width - PADDING}
            y2={toY(level)}
            stroke="var(--color-gold-500)"
            strokeOpacity={0.1}
          />
        ))}
        <path d={pathD} fill="none" stroke="var(--color-burgundy-400)" strokeWidth={2} />
        {points.map((p, i) => (
          <circle
            key={p.tastingId}
            cx={toX(i)}
            cy={toY(p.rating)}
            r={3}
            fill="var(--color-gold-500)"
          />
        ))}
      </svg>
      <p className="sr-only">
        {points
          .map(
            (p) =>
              `${new Date(p.tastedAt).toLocaleDateString('ko-KR')} ${p.rating}점 (${
                p.ratingSource === 'manual' ? '수동' : 'AI'
              } 평점)`,
          )
          .join(', ')}
      </p>
    </div>
  );
}
