'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { signedFetch } from '@/lib/http/signedFetch';

/**
 * 쓰기 액션 가드.
 *
 * 세션이 없는 방문자가 쓰기 액션을 시도하면 서버가 401 + loginUrl 을 반환한다
 * (design.md 'API 계약'). 이 컴포넌트/훅은 그 401 을 감지해:
 * 1. 현재 폼 초안을 sessionStorage 에 저장한다.
 * 2. loginUrl 로 이동시킨다 (Google 로그인 화면 경유).
 * 3. 로그인 완료 후 원래 화면으로 복귀하면 초안을 복원한다.
 *
 * 초안 키는 "경로 + 폼id" 조합으로 만들어 여러 폼이 공존해도 충돌하지 않는다.
 */

interface UnauthorizedResponseBody {
  error: 'UNAUTHORIZED';
  loginUrl: string;
}

function isUnauthorizedBody(value: unknown): value is UnauthorizedResponseBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).error === 'UNAUTHORIZED' &&
    typeof (value as Record<string, unknown>).loginUrl === 'string'
  );
}

/** 초안 저장소 키 생성 — 경로 + 폼id 기반 */
function draftStorageKey(formId: string): string {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  return `waganda:draft:${path}:${formId}`;
}

/** 폼 초안을 sessionStorage 에 저장한다. */
export function saveDraft<T>(formId: string, draft: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(draftStorageKey(formId), JSON.stringify(draft));
  } catch {
    // sessionStorage 를 사용할 수 없는 환경(프라이버시 모드 등)에서는 조용히 무시한다.
    // 초안 보존은 편의 기능이며 핵심 흐름을 막아서는 안 된다.
  }
}

/** 저장된 폼 초안을 읽는다. 없으면 null. */
export function loadDraft<T>(formId: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(formId));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 저장된 폼 초안을 제거한다. */
export function clearDraft(formId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(draftStorageKey(formId));
  } catch {
    // 무시
  }
}

interface UseWriteActionOptions {
  /** 초안 식별자. 경로와 조합되어 저장 키를 만든다. */
  formId: string;
}

interface UseWriteActionResult {
  /**
   * fetch 를 감싸는 실행 함수. 401 응답을 감지하면 draft 를 저장하고
   * loginUrl 로 이동시킨 뒤 아무 값도 반환하지 않는다(리다이렉트로 흐름이 끊긴다).
   * 401 이 아니면 원본 Response 를 그대로 반환한다.
   */
  runWriteAction: (
    input: RequestInfo | URL,
    init?: RequestInit,
    draft?: unknown,
  ) => Promise<Response>;
  /** 복귀 후 복원된 초안. 아직 없으면 null. */
  restoredDraft: unknown;
  /** 복원된 초안을 소비 후 지운다. */
  consumeRestoredDraft: () => void;
  /** 진행 중인 로그인 리다이렉트 여부 (UI 에서 로딩 상태 표시용) */
  isRedirectingToLogin: boolean;
}

/**
 * 쓰기 액션 훅.
 *
 * 사용 예:
 * ```tsx
 * const { runWriteAction, restoredDraft, consumeRestoredDraft } = useWriteAction({ formId: 'tasting-form' });
 *
 * useEffect(() => {
 *   if (restoredDraft) {
 *     setFormState(restoredDraft);
 *     consumeRestoredDraft();
 *   }
 * }, [restoredDraft]);
 *
 * async function onSubmit() {
 *   const res = await runWriteAction('/api/tastings', { method: 'POST', body: ... }, formState);
 *   if (res.ok) { ... }
 * }
 * ```
 */
export function useWriteAction({ formId }: UseWriteActionOptions): UseWriteActionResult {
  const [restoredDraft, setRestoredDraft] = useState<unknown>(null);
  const [isRedirectingToLogin, setIsRedirectingToLogin] = useState(false);
  const hasCheckedRestore = useRef(false);

  useEffect(() => {
    if (hasCheckedRestore.current) return;
    hasCheckedRestore.current = true;
    const draft = loadDraft(formId);
    if (draft !== null) {
      setRestoredDraft(draft);
    }
  }, [formId]);

  const consumeRestoredDraft = useCallback(() => {
    clearDraft(formId);
    setRestoredDraft(null);
  }, [formId]);

  const runWriteAction = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit, draft?: unknown): Promise<Response> => {
      // CloudFront OAC 는 본문을 서명에 포함하지 않는다. 본문 해시 헤더가 없으면
      // Lambda Function URL 이 서명 불일치로 거부한다(`lib/http/signedFetch.ts`).
      const response = await signedFetch(input, init);

      if (response.status === 401) {
        let body: unknown = null;
        try {
          body = await response.clone().json();
        } catch {
          // 본문이 JSON 이 아닐 수도 있다 — loginUrl 없이는 이동할 수 없으므로 그대로 응답을 반환한다.
        }

        if (isUnauthorizedBody(body)) {
          if (draft !== undefined) {
            saveDraft(formId, draft);
          }
          setIsRedirectingToLogin(true);
          window.location.href = body.loginUrl;
          // 리다이렉트가 진행되므로 이 반환값은 실질적으로 소비되지 않는다.
          return response;
        }
      }

      return response;
    },
    [formId],
  );

  return {
    runWriteAction,
    restoredDraft,
    consumeRestoredDraft,
    isRedirectingToLogin,
  };
}

interface WriteActionGuardContextValue {
  formId: string;
}

const WriteActionGuardContext = createContext<WriteActionGuardContextValue | null>(null);

interface WriteActionGuardProps {
  /** 초안 식별자. 하위에서 useWriteActionGuardContext 로 조회할 수 있다. */
  formId: string;
  children: ReactNode;
  /** 로그인 리다이렉트 중 표시할 안내문. 접근성을 위해 role="status" 로 노출한다. */
  redirectingLabel?: string;
}

/**
 * <WriteActionGuard> 래퍼 컴포넌트.
 *
 * 하위 폼을 감싸 초안 컨텍스트(formId)를 제공하고, 로그인 리다이렉트가 진행되는 동안
 * 접근성을 갖춘 상태 안내(role="status", aria-live="polite")를 렌더링한다.
 * 키보드 사용자가 리다이렉트 상태를 인지할 수 있도록 포커스 가능한 안내 텍스트를 제공한다.
 */
export function WriteActionGuard({
  formId,
  children,
  redirectingLabel = '로그인 화면으로 이동합니다. 잠시만 기다려 주세요.',
}: WriteActionGuardProps): ReactNode {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const contextValue = useMemo(() => ({ formId }), [formId]);

  useEffect(() => {
    function handleBeforeUnload(): void {
      setIsRedirecting(true);
    }
    // 로그인 리다이렉트는 window.location.href 이동으로 발생하므로,
    // 언로드 직전 안내를 노출할 기회를 얻기 위해 리스너를 등록한다.
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return (
    <WriteActionGuardContext.Provider value={contextValue}>
      <div>
        {isRedirecting && (
          <p role="status" aria-live="polite" tabIndex={-1}>
            {redirectingLabel}
          </p>
        )}
        {children}
      </div>
    </WriteActionGuardContext.Provider>
  );
}

/** WriteActionGuard 내부에서 formId 를 조회하는 훅. Provider 밖에서 쓰면 에러를 던진다. */
export function useWriteActionGuardContext(): WriteActionGuardContextValue {
  const context = useContext(WriteActionGuardContext);
  if (!context) {
    throw new Error(
      'useWriteActionGuardContext 는 <WriteActionGuard> 내부에서만 사용할 수 있습니다.',
    );
  }
  return context;
}
