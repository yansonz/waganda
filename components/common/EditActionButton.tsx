'use client';

import { useState, type ReactElement } from 'react';
import { useWriteAction } from '@/components/auth/WriteActionGuard';

/**
 * components/common/EditActionButton.tsx — 편집·삭제 컨트롤 공통 버튼.
 *
 * R1/R9: 편집·삭제 컨트롤은 세션 유무와 무관하게 항상 렌더링하고, 클릭 시
 * `useWriteAction` 을 통해 401 을 감지하면 로그인 흐름으로 전환한다(세션으로 숨기지 않는다).
 *
 * 실제 쓰기 API 를 호출해 401 여부를 확인해야 하므로, endpoint/method 를 받아
 * `runWriteAction` 으로 실행한다. 성공 시 onSuccess 콜백을 호출한다.
 */
interface EditActionButtonProps {
  /** 초안 식별자 겸 폼 id — 경로와 조합되어 sessionStorage 키를 만든다 */
  formId: string;
  /** 호출할 쓰기 API 경로 */
  endpoint: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  /** 버튼 표시 텍스트 */
  children: string;
  /** 스크린리더용 상세 설명(예: "샤블리 2018 삭제") */
  ariaLabel: string;
  /** 요청 본문(JSON) */
  body?: unknown;
  onSuccess?: (response: Response) => void;
  className?: string;
}

export function EditActionButton({
  formId,
  endpoint,
  method,
  children,
  ariaLabel,
  body,
  onSuccess,
  className,
}: EditActionButtonProps): ReactElement {
  const { runWriteAction } = useWriteAction({ formId });
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setIsPending(true);
    setErrorMessage(null);
    try {
      const response = await runWriteAction(
        endpoint,
        {
          method,
          headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        body,
      );
      if (response.ok) {
        onSuccess?.(response);
        return;
      }

      // 401은 runWriteAction이 로그인 흐름으로 전환한다.
      if (response.status !== 401) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setErrorMessage(body.message ?? `요청을 처리하지 못했습니다. (오류 ${response.status})`);
      }
    } catch {
      setErrorMessage('네트워크 오류로 요청을 처리하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={isPending}
        onClick={handleClick}
        className={
          className ??
          'rounded-md border border-gold-500/40 px-3 py-1.5 text-sm text-cream-100 hover:bg-ink-800 disabled:opacity-50'
        }
      >
        {isPending ? '처리 중…' : children}
      </button>
      {errorMessage && (
        <p role="alert" className="text-sm text-burgundy-300">
          {errorMessage}
        </p>
      )}
    </>
  );
}
