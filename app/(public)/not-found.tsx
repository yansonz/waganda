import Link from 'next/link';
import type { ReactElement } from 'react';

/**
 * app/(public)/not-found.tsx — 공개 화면의 없는 페이지 안내.
 *
 * 삭제한 기록의 URL 로 되돌아오는 경우(뒤로 가기·북마크·오래된 링크)가 흔하다.
 * 기본 404 대신 무슨 일이 있었는지 알려주고 돌아갈 길을 준다.
 */
export default function PublicNotFound(): ReactElement {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-display text-2xl text-cream-100">기록을 찾을 수 없습니다</h1>
      <p className="text-muted max-w-md text-sm">
        삭제되었거나 주소가 바뀐 기록일 수 있습니다. 다른 기록을 둘러보세요.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="rounded border border-gold-500/40 px-3 py-2 text-sm text-gold-300 hover:bg-gold-500/10"
        >
          대시보드
        </Link>
        <Link
          href="/timeline"
          className="rounded border border-gold-500/20 px-3 py-2 text-sm text-cream-200 hover:bg-ink-800"
        >
          타임라인
        </Link>
        <Link
          href="/wines"
          className="rounded border border-gold-500/20 px-3 py-2 text-sm text-cream-200 hover:bg-ink-800"
        >
          와인 목록
        </Link>
      </div>
    </div>
  );
}
