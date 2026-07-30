'use client';

import { useState, type ReactElement } from 'react';
import { EditorOnly } from '@/components/auth/EditorSession';
import { useWriteAction } from '@/components/auth/WriteActionGuard';

/**
 * components/tasting/ManualRatingControl.tsx — 수동 평점 입력 (R6).
 *
 * 정책: AI 가 음성 분석으로 먼저 평점을 판단하고, 편집자가 수동 평점을 넣으면
 * **화면에는 수동 평점만** 보인다. 두 값은 각각 보존된다
 * (`Tasting.manualRating` / `Analysis.aiRating`) — 표시만 하나로 좁힌다.
 *
 * 세션 유무와 무관하게 렌더링하고, 저장 시 401 이면 로그인 흐름으로 전환한다 (R1).
 */
interface ManualRatingControlProps {
  tastingId: string;
  /** 현재 대표 평점 */
  currentRating?: number;
  /** 대표 평점의 출처 */
  ratingSource?: 'manual' | 'ai';
  /** 낙관적 동시성 대조용 리비전 */
  rev: number;
}

/** 1~5, 0.5 단위 선택 값 */
const RATING_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;

export function ManualRatingControl({
  tastingId,
  currentRating,
  ratingSource,
  rev,
}: ManualRatingControlProps): ReactElement {
  const formId = `tasting-manual-rating-${tastingId}`;
  const { runWriteAction, restoredDraft, consumeRestoredDraft } = useWriteAction({ formId });

  // 로그인 후 복귀 시 입력하던 값을 되살린다.
  const restored =
    restoredDraft && typeof restoredDraft === 'object' && 'manualRating' in restoredDraft
      ? Number((restoredDraft as { manualRating: unknown }).manualRating)
      : undefined;

  const [value, setValue] = useState<number>(restored ?? currentRating ?? 3);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [consumed, setConsumed] = useState(false);

  if (restored !== undefined && !consumed) {
    setConsumed(true);
    consumeRestoredDraft();
  }

  async function save(): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      const response = await runWriteAction(
        `/api/tastings/${tastingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manualRating: value, rev }),
        },
        { manualRating: value },
      );

      if (response.ok) {
        setMessage('수동 평점을 저장했습니다. 이제 이 평점이 표시됩니다.');
        // 서버 렌더 화면을 갱신해 대표 평점을 반영한다.
        window.location.reload();
        return;
      }

      if (response.status === 401) {
        // runWriteAction 이 로그인 흐름으로 전환한다.
        return;
      }
      if (response.status === 409) {
        setMessage('다른 곳에서 먼저 수정되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      setMessage(body.message ?? `저장에 실패했습니다. (오류 ${response.status})`);
    } catch {
      setMessage('네트워크 오류로 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  const selectId = `${formId}-select`;

  return (
    <EditorOnly>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-muted text-sm">
            수동 평점
          </label>
          <select
            id={selectId}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="rounded border border-gold-500/30 bg-ink-900 px-2 py-1 text-sm text-cream-100"
          >
            {RATING_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {Number.isInteger(option) ? option : option.toFixed(1)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            aria-label="수동 평점 저장"
            className="rounded border border-gold-500/40 px-3 py-1 text-sm text-gold-300 disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>

        {ratingSource === 'ai' && (
          <p className="text-muted text-xs">
            지금은 음성 분석으로 산출한 AI 평점이 표시됩니다. 수동 평점을 저장하면 그 값이 대신
            표시됩니다.
          </p>
        )}
        {ratingSource === 'manual' && (
          <p className="text-muted text-xs">
            수동 평점이 표시 중입니다. AI 평점은 그대로 보존됩니다.
          </p>
        )}

        {message && (
          <p role="status" className="text-sm text-cream-200">
            {message}
          </p>
        )}
      </div>
    </EditorOnly>
  );
}
