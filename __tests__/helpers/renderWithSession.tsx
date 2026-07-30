import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { EditorSessionProvider } from '@/components/auth/EditorSession';

/**
 * __tests__/helpers/renderWithSession.tsx — 세션 상태를 고정해 렌더한다.
 *
 * 정책: 로그인한 편집자에게만 쓰기 UI 가 보인다.
 * 그래서 쓰기 컴포넌트 테스트는 로그인 상태를 명시적으로 주입해야 한다.
 */

/** 로그인한 편집자로 렌더 */
export function renderAsEditor(ui: ReactElement, email = 'yan@example.com'): RenderResult {
  return render(
    <EditorSessionProvider override={{ loaded: true, authenticated: true, email }}>
      {ui}
    </EditorSessionProvider>,
  );
}

/** 비로그인 방문자로 렌더 */
export function renderAsVisitor(ui: ReactElement): RenderResult {
  return render(
    <EditorSessionProvider override={{ loaded: true, authenticated: false }}>
      {ui}
    </EditorSessionProvider>,
  );
}
