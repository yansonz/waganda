import type { ReactElement } from 'react';
import type { AgreementPoint } from '@waganda/schemas';

/**
 * components/profile/AgreementTrend.tsx — 월별 반응 일치도 추이 차트 (순수 SVG, 12.6).
 */
interface AgreementTrendProps {
  points: AgreementPoint[];
  width?: number;
  height?: number;
}

const PADDING = 28;

export function AgreementTrend({
  points,
  width = 480,
  height = 160,
}: AgreementTrendProps): ReactElement {
  if (points.length === 0) {
    return (
      <p role="status" className="text-muted text-sm">
        반응 일치도 데이터가 없습니다.
      </p>
    );
  }

  const innerWidth = width - PADDING * 2;
  const innerHeight = height - PADDING * 2;

  const toX = (index: number): number =>
    points.length === 1
      ? PADDING + innerWidth / 2
      : PADDING + (index / (points.length - 1)) * innerWidth;
  const toY = (score: number): number => PADDING + innerHeight - (score / 100) * innerHeight;

  const barWidth = Math.min(24, innerWidth / points.length - 8);

  const describedId = 'agreement-trend-desc';

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-labelledby={describedId}
      >
        <title id={describedId}>월별 반응 일치도 추이 그래프 (0에서 100)</title>
        {[0, 25, 50, 75, 100].map((level) => (
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
        {points.map((p, i) => (
          <rect
            key={p.month}
            x={toX(i) - barWidth / 2}
            y={toY(p.meanScore)}
            width={barWidth}
            height={innerHeight - (toY(p.meanScore) - PADDING)}
            fill="var(--color-burgundy-500)"
          />
        ))}
        {points.map((p, i) => (
          <text
            key={`${p.month}-label`}
            x={toX(i)}
            y={height - 6}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-cream-300)"
          >
            {p.month.slice(5)}월
          </text>
        ))}
      </svg>
      <p className="sr-only">
        {points
          .map((p) => `${p.month} 평균 일치도 ${p.meanScore.toFixed(0)}점 (표본 ${p.n}건)`)
          .join(', ')}
      </p>
    </div>
  );
}
