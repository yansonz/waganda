'use client';

/**
 * components/wine/DuplicateCandidateDialog.tsx — 중복 와인 후보 제시 다이얼로그 (6.5).
 *
 * requirements.md R4: "동일 와인명·빈티지·와이너리 조합이 이미 존재하면 중복 후보를
 * 제시하고 기존 와인에 시음을 추가할지 묻는다".
 *
 * 접근성: `role="dialog"` + `aria-modal="true"`, 포커스를 다이얼로그 내부로 트랩하고
 * ESC 로 닫을 수 있게 한다.
 */
import { useEffect, useRef } from 'react';
import type { DuplicateCandidate } from '@waganda/schemas';

export interface DuplicateCandidateDialogProps {
  open: boolean;
  candidates: DuplicateCandidate[];
  /** 기존 와인에 시음 추가를 선택했을 때 */
  onSelectExisting: (wineId: string) => void;
  /** 새로 등록을 선택했을 때 */
  onCreateNew: () => void;
  /** 다이얼로그를 닫을 때 (ESC, 배경 클릭 등) */
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * 중복 와인 후보 목록을 제시하고, 사용자가 "기존 와인에 시음 추가" 또는
 * "새로 등록"을 선택하게 하는 모달 다이얼로그.
 */
export function DuplicateCandidateDialog({
  open,
  candidates,
  onSelectExisting,
  onCreateNew,
  onClose,
}: DuplicateCandidateDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = 'duplicate-candidate-dialog-title';

  // 다이얼로그가 열리면 첫 포커스 가능 요소로 포커스를 이동한다.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const focusable = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable[0]?.focus();
  }, [open]);

  // ESC 로 닫기 + Tab 키보드 트랩
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const node = dialogRef.current;
        if (!node) return;
        const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold text-cream-100">
          비슷한 와인이 이미 있습니다
        </h2>
        <p className="mt-1 text-sm text-muted">
          아래 후보 중 하나가 지금 등록하려는 와인과 같다면, 새로 만들지 않고 기존 와인에 시음
          기록을 추가할 수 있습니다.
        </p>

        <ul className="mt-4 space-y-2">
          {candidates.map((candidate) => (
            <li
              key={candidate.wineId}
              className="flex items-center justify-between gap-3 rounded-md border border-ink-700 p-3"
            >
              <div>
                <p className="text-sm font-medium text-cream-100">
                  {candidate.name}
                  {candidate.vintage ? ` (${candidate.vintage})` : ''}
                </p>
                {candidate.wineryName && (
                  <p className="text-xs text-muted">{candidate.wineryName}</p>
                )}
                <p className="text-xs text-muted">기존 시음 기록 {candidate.tastingCount}건</p>
              </div>
              <button
                type="button"
                onClick={() => onSelectExisting(candidate.wineId)}
                className="whitespace-nowrap rounded-md bg-burgundy-700 px-3 py-1.5 text-sm font-medium text-cream-50"
              >
                이 와인에 시음 추가
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onCreateNew}
            className="rounded-md bg-ink-800 px-3 py-2 text-sm font-medium text-cream-100"
          >
            새 와인으로 등록
          </button>
        </div>
      </div>
    </div>
  );
}
