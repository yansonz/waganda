import type { ReactElement } from 'react';
import type { FitLevel } from '@waganda/schemas';

/**
 * components/wine/FitBadge.tsx — 취향 적합도 뱃지 (12.5, R7).
 *
 * 색상만으로 구분하지 않도록 텍스트 라벨을 항상 함께 표시한다.
 */
interface FitBadgeProps {
  level: FitLevel;
}

const FIT_LABEL: Record<FitLevel, string> = {
  perfect: '딱 맞아',
  challenging: '도전적',
  dislike: '비선호 구간',
  unknown: '데이터 부족',
};

const FIT_STYLE: Record<FitLevel, string> = {
  perfect: 'bg-gold-500/20 text-gold-400 border-gold-500/50',
  challenging: 'bg-burgundy-600/20 text-burgundy-300 border-burgundy-500/50',
  dislike: 'bg-ink-950 text-cream-300 border-cream-300/30',
  unknown: 'bg-ink-800 text-muted border-cream-300/15',
};

export function FitBadge({ level }: FitBadgeProps): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${FIT_STYLE[level]}`}
    >
      취향 적합도: {FIT_LABEL[level]}
    </span>
  );
}
