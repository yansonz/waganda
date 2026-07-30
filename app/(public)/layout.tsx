import type { ReactElement, ReactNode } from 'react';
import { EditorSessionProvider } from '@/components/auth/EditorSession';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';

/**
 * app/(public)/layout.tsx — 공개 화면 공통 레이아웃 (14.1).
 *
 * 로그인 없이 열람 가능한 모든 화면에 공통 헤더/푸터를 적용한다.
 * 모바일 375px 폭 기준으로 좌우 패딩을 최소화해 콘텐츠 폭을 확보한다.
 */
export default function PublicLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <EditorSessionProvider>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <SiteFooter />
      </div>
    </EditorSessionProvider>
  );
}
