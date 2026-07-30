import Link from 'next/link';
import type { ReactElement } from 'react';
import { EditorOnly } from '@/components/auth/EditorSession';
import { LoginButton } from '@/components/auth/LoginButton';

/**
 * components/layout/SiteHeader.tsx — 공개 화면 공통 헤더.
 *
 * 시맨틱 <header>/<nav> 사용, 모바일 375px 폭에서도 줄바꿈 없이 스크롤 가능하도록
 * 가로 스크롤 내비게이션으로 구성한다.
 *
 * 우상단에 로그인 진입점을 둔다. 기록 작성(`/record`)은 쓰기 화면이므로
 * **로그인한 편집자에게만** 링크를 노출한다.
 */
/**
 * 내비게이션 링크.
 * 홈(대시보드)은 좌측 "와간다" 로고가 담당하므로 탭으로 중복 노출하지 않는다.
 * 지역 탐색(`/explore`)은 탭에서 내렸다 — 와인·타임라인과 진입점이 겹친다.
 */
const NAV_LINKS: { href: string; label: string }[] = [
  { href: '/wines', label: '와인' },
  { href: '/timeline', label: '타임라인' },
  { href: '/rankings', label: '랭킹' },
  { href: '/discoveries', label: '발견' },
];

export function SiteHeader(): ReactElement {
  return (
    <header className="border-b border-gold-500/15 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="font-display text-xl text-gold-400"
          aria-label="와간다 홈으로 이동"
        >
          와간다
        </Link>

        <nav aria-label="주요 메뉴" className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-cream-200 hover:bg-ink-800 hover:text-gold-400"
            >
              {link.label}
            </Link>
          ))}
          <EditorOnly>
            <Link
              href="/record"
              className="whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-gold-300 hover:bg-ink-800"
            >
              기록
            </Link>
          </EditorOnly>
        </nav>

        <LoginButton />
      </div>
    </header>
  );
}
