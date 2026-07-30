'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * components/auth/EditorSession.tsx — 편집자 세션 상태 공유.
 *
 * 정책: **로그인해야 수정·삭제 같은 쓰기 UI 가 보인다.** 비로그인 방문자는 열람만 한다.
 *
 * 세션 판별을 서버 렌더가 아니라 브라우저에서 하는 이유:
 * 공개 페이지는 CloudFront 장기 캐시 대상이라, HTML 에 로그인 상태별 UI 를 넣으면
 * 캐시된 응답이 다른 방문자에게 섞여 나간다. HTML 은 항상 비로그인 형태로 두고
 * `/api/auth/session`(no-store) 결과로 쓰기 UI 만 덧붙인다.
 */
export interface EditorSessionState {
  /** 조회 완료 여부 — 완료 전에는 쓰기 UI 를 그리지 않는다 */
  loaded: boolean;
  authenticated: boolean;
  email?: string;
}

const EditorSessionContext = createContext<EditorSessionState | null>(null);

/** 세션 상태를 한 번만 조회해 하위 컴포넌트가 공유한다 */
export function EditorSessionProvider({
  children,
  override,
}: {
  children: ReactNode;
  /**
   * 세션 상태를 직접 주입한다. 주입하면 `/api/auth/session` 을 호출하지 않는다.
   * 테스트에서 로그인/비로그인 상태를 고정할 때 쓴다.
   */
  override?: EditorSessionState;
}): ReactElement {
  const [state, setState] = useState<EditorSessionState>(
    override ?? {
      loaded: false,
      authenticated: false,
    },
  );

  useEffect(() => {
    if (override) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
        });
        if (!response.ok) {
          if (!cancelled) setState({ loaded: true, authenticated: false });
          return;
        }
        const body = (await response.json()) as {
          authenticated?: boolean;
          email?: string;
        };
        if (!cancelled) {
          setState({
            loaded: true,
            authenticated: body.authenticated === true,
            email: body.email,
          });
        }
      } catch {
        // 조회 실패 시에는 비로그인으로 취급한다 (쓰기 UI 를 노출하지 않는 쪽이 안전하다)
        if (!cancelled) setState({ loaded: true, authenticated: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [override]);

  const value = useMemo(() => state, [state]);

  return <EditorSessionContext.Provider value={value}>{children}</EditorSessionContext.Provider>;
}

/**
 * 세션 상태 조회.
 * Provider 밖에서 쓰이면 "비로그인"으로 응답한다 — 쓰기 UI 가 실수로 노출되지 않게 한다.
 */
export function useEditorSession(): EditorSessionState {
  return useContext(EditorSessionContext) ?? { loaded: false, authenticated: false };
}

/**
 * 편집자에게만 보여줄 UI 를 감싼다.
 *
 * 서버 권한 검사를 대체하지 않는다 — 쓰기 API 는 여전히 세션을 요구하며(R1),
 * 이것은 표시 정책일 뿐이다.
 */
export function EditorOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): ReactElement | null {
  const { loaded, authenticated } = useEditorSession();

  if (!loaded) return null;
  if (!authenticated) return <>{fallback}</>;
  return <>{children}</>;
}
