'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { useEditorSession } from '@/components/auth/EditorSession';

/**
 * components/record/RecordEntryPoint.tsx — 시음 기록 추가 진입점.
 *
 * 정책(R1): 열람은 누구나, 기록은 로그인한 편집자만.
 * - 로그인: "시음 기록 추가" 버튼 → `/record`
 * - 비로그인: 로그인해야 기록할 수 있다는 안내 + 로그인 링크
 *
 * 세션 판별은 브라우저에서 한다 — 공개 페이지는 CDN 장기 캐시 대상이라
 * 서버 렌더 HTML 에 로그인 상태를 담으면 캐시가 섞인다.
 */
export function RecordEntryPoint({ className }: { className?: string }): ReactElement {
  const { loaded, authenticated } = useEditorSession();

  // 조회 전에는 아무것도 그리지 않는다 (로그인 상태가 깜빡이지 않게)
  if (!loaded) {
    return <span aria-hidden="true" className="block h-9" />;
  }

  if (authenticated) {
    return (
      <Link
        href="/record"
        className={`inline-flex items-center gap-1 rounded-md bg-burgundy-700 px-3 py-2 text-sm font-medium text-cream-50 hover:bg-burgundy-600 ${className ?? ''}`}
      >
        <span aria-hidden="true">+</span> 시음 기록 추가
      </Link>
    );
  }

  return (
    <p
      className={`text-muted flex flex-wrap items-center gap-2 text-sm ${className ?? ''}`}
      role="note"
    >
      <span>기록은 로그인한 편집자만 추가할 수 있습니다.</span>
      <a
        href="/api/auth/google/start?returnTo=%2Frecord"
        className="rounded border border-gold-500/40 px-2 py-1 text-xs text-gold-300 hover:bg-gold-500/10"
      >
        로그인하고 기록하기
      </a>
    </p>
  );
}
