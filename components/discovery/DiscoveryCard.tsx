import Link from 'next/link';
import type { ReactElement } from 'react';
import type { DiscoveryGrade } from '@waganda/schemas';
import type { DiscoveryView } from '@/lib/views/read';

/**
 * components/discovery/DiscoveryCard.tsx — 발견 카드 (13.3/13.6, R8).
 *
 * 패턴 서술, 별칭, 근거 시음 링크, 표본 수, 신뢰 등급, 우연 가능성 문구를 표시한다.
 * 등급은 색상뿐 아니라 텍스트로도 구분한다.
 */
interface DiscoveryCardProps {
  discovery: DiscoveryView;
}

const GRADE_LABEL: Record<DiscoveryGrade, string> = {
  weak: '약함',
  moderate: '보통',
  strong: '뚜렷함',
};

const GRADE_STYLE: Record<DiscoveryGrade, string> = {
  weak: 'bg-ink-800 text-cream-300 border-cream-300/20',
  moderate: 'bg-gold-500/15 text-gold-400 border-gold-500/40',
  strong: 'bg-burgundy-600/25 text-burgundy-200 border-burgundy-500/50',
};

export function DiscoveryCard({ discovery }: DiscoveryCardProps): ReactElement {
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-lg text-cream-100">{discovery.alias}</h3>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${GRADE_STYLE[discovery.grade]}`}
        >
          신뢰 등급: {GRADE_LABEL[discovery.grade]}
        </span>
      </div>
      <p className="text-cream-200 mt-2 text-sm">{discovery.description}</p>
      <p className="text-muted mt-2 text-xs">표본 {discovery.n}건</p>
      <p className="text-muted mt-1 text-xs">{discovery.disclaimer}</p>
      {discovery.updatedFromN !== undefined && (
        <p className="text-gold-400 mt-1 text-xs">
          표본이 {discovery.updatedFromN}건에서 늘어 갱신되었습니다.
        </p>
      )}
      {discovery.evidenceTastingIds.length > 0 && (
        <nav aria-label="근거 시음 목록" className="mt-3 flex flex-wrap gap-2">
          {discovery.evidenceTastingIds.map((id, index) => (
            <Link
              key={id}
              href={`/tastings/${id}`}
              className="rounded-md border border-gold-500/30 px-2 py-1 text-xs text-cream-200 hover:bg-ink-800"
            >
              근거 시음 {index + 1}
            </Link>
          ))}
        </nav>
      )}
    </article>
  );
}
