'use client';

import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { useEditorSession } from '@/components/auth/EditorSession';

/**
 * components/auth/LoginButton.tsx — 헤더 우상단 로그인/로그아웃 진입점.
 *
 * - 비로그인: "로그인" — 현재 경로로 돌아오도록 returnTo 를 붙인다.
 * - 로그인: 이메일과 "로그아웃".
 *
 * 세션 판별은 브라우저에서 하므로(CDN 캐시 대응) 조회 완료 전에는
 * 레이아웃이 흔들리지 않도록 자리만 차지하는 자리표시자를 둔다.
 */
export function LoginButton(): ReactElement {
  const { loaded, authenticated, email } = useEditorSession();
  const pathname = usePathname();

  if (!loaded) {
    // 조회 중 — 폭을 유지해 헤더가 밀리지 않게 한다
    return (
      <span aria-hidden="true" className="text-muted text-sm opacity-0">
        로그인
      </span>
    );
  }

  if (!authenticated) {
    const returnTo = encodeURIComponent(pathname || '/');
    return (
      <a
        href={`/api/auth/google/start?returnTo=${returnTo}`}
        className="rounded border border-gold-500/40 px-3 py-1 text-sm text-gold-300 hover:bg-gold-500/10"
      >
        로그인
      </a>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-muted hidden text-xs sm:inline" title={email}>
        {email}
      </span>
      <a
        href="/api/auth/logout"
        className="rounded border border-gold-500/25 px-3 py-1 text-sm text-cream-200 hover:bg-gold-500/10"
      >
        로그아웃
      </a>
    </span>
  );
}
