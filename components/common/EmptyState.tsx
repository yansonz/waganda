import type { ReactElement } from 'react';

/**
 * components/common/EmptyState.tsx — 데이터 없는 상태 공통 표시.
 *
 * 시맨틱하게는 상태 안내이므로 role="status" 로 스크린리더에 전달한다.
 * 색상만으로 의미를 전달하지 않도록 아이콘 대신 텍스트 문구를 사용한다.
 */
interface EmptyStateProps {
  /** 상태 제목 (예: "아직 시음 기록이 없어요") */
  title: string;
  /** 보조 설명 */
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps): ReactElement {
  return (
    <div role="status" className="card p-6 text-center">
      <p className="font-display text-lg text-cream-100">{title}</p>
      {description && <p className="text-muted mt-2 text-sm">{description}</p>}
    </div>
  );
}
