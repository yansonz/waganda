import type { ReactElement } from 'react';

/**
 * components/common/Rating.tsx — 평점 표시(1~5, 0.5 단위).
 *
 * 별 아이콘을 쓰지 않고 **숫자만** 표시한다.
 * 0.5 단위 평점을 별로 그리려면 반쪽 별이 필요한데,
 * 유니코드 반별 글리프(U+2BEA 등)는 지원 폰트가 적어 두부(□)로 깨진다.
 * 숫자 표기가 0.5 단위를 정확히 전달하고 폰트에 의존하지 않는다.
 *
 * 색상만으로 정보를 전달하지 않으며, 스크린리더에는 만점 정보를 함께 제공한다.
 */
interface RatingProps {
  /** 1~5, 0.5 단위 */
  value: number;
  /** 평점 출처 표시 (예: "AI 평점" / "수동 평점") */
  label?: string;
  className?: string;
}

/** 평점 만점 */
const MAX_RATING = 5;

export function Rating({ value, label, className }: RatingProps): ReactElement {
  // 4 → "4", 4.5 → "4.5" (불필요한 소수점 0 은 붙이지 않는다)
  const display = Number.isInteger(value) ? String(value) : value.toFixed(1);

  const accessibleLabel = label
    ? `${label} ${display}점 (${MAX_RATING}점 만점)`
    : `${display}점 (${MAX_RATING}점 만점)`;

  return (
    <span
      className={`inline-flex items-baseline gap-1 ${className ?? ''}`}
      // aria-label 만 있는 generic span 은 접근성 트리에 이름이 노출되지 않는다.
      // 숫자·"/ 5" 를 하나의 의미 단위로 읽히게 하려면 명시적 role 이 필요하다.
      role="img"
      aria-label={accessibleLabel}
    >
      <span className="text-gold-500 font-display text-base leading-none">{display}</span>
      <span aria-hidden="true" className="text-muted text-xs">
        / {MAX_RATING}
      </span>
    </span>
  );
}
