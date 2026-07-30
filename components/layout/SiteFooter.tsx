import type { ReactElement } from 'react';

/**
 * components/layout/SiteFooter.tsx — 공개 화면 공통 푸터.
 */
export function SiteFooter(): ReactElement {
  return (
    <footer className="border-t border-gold-500/15 py-6">
      <div className="mx-auto max-w-5xl px-4 text-center text-sm text-muted">
        <p>와간다 — 얀버트 부부의 와인 시음 기록</p>
      </div>
    </footer>
  );
}
