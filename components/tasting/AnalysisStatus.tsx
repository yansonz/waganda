'use client';

/**
 * components/tasting/AnalysisStatus.tsx — 분석 진행 상태 표시 (10.8).
 *
 * requirements.md R5: "분석이 진행 중이면 진행 상태와 예상 소요 시간을 표시",
 * "분석이 완료되면 화면을 자동 갱신하고 브라우저 알림(허용된 경우)을 발송".
 *
 * - `queued`/`transcribing`/`analyzing`/`completed`/`failed` 5개 상태를 표시한다.
 * - 진행 중일 때 `ESTIMATED_SEC_BY_STATUS` 로 예상 소요 시간을 안내한다.
 * - 완료 전까지 폴링하고, 완료 감지 시 자동 갱신 콜백을 호출하며 언마운트 시 폴링을 정리한다.
 * - 알림 권한이 이미 허용된 경우에만 Notification 을 발송한다. 권한이 없거나
 *   Notification API 자체가 없는 환경에서는 조용히 생략한다(요청하지 않는다).
 * - 재분석 버튼은 `useWriteAction` 으로 호출해 미인증 시 로그인 흐름으로 전환한다.
 */
import { useEffect, useRef, useState } from 'react';
import { ESTIMATED_SEC_BY_STATUS, type JobStatus } from '@waganda/schemas';
import { EditorOnly } from '@/components/auth/EditorSession';
import { useWriteAction } from '@/components/auth/WriteActionGuard';

export interface AnalysisStatusProps {
  tastingId: string;
  /** 초기 상태 (서버 컴포넌트에서 최초 렌더링 시 전달) */
  initialStatus: JobStatus;
  /** 상태를 다시 조회하는 함수 — 상위에서 fetch 래핑을 주입한다(테스트 용이성) */
  fetchStatus: (tastingId: string) => Promise<{ status: JobStatus }>;
  /** 완료가 감지되면 호출된다 (예: 분석 결과 다시 불러오기) */
  onCompleted?: () => void;
  /** 폴링 주기(ms). 기본 5000ms. */
  pollIntervalMs?: number;
  /** 브라우저 알림 API 주입 — 테스트에서 vi.stubGlobal 로 교체 가능 */
  notificationApi?: typeof Notification;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '대기 중',
  transcribing: '음성 변환 중',
  analyzing: '분석 중',
  completed: '분석 완료',
  failed: '분석 실패',
};

const STATUS_ICON: Record<JobStatus, string> = {
  queued: '⏳',
  transcribing: '🎙️',
  analyzing: '🤖',
  completed: '✅',
  failed: '⚠️',
};

const IN_PROGRESS_STATUSES: JobStatus[] = ['queued', 'transcribing', 'analyzing'];

function formatEstimatedSec(sec: number): string {
  if (sec <= 0) return '';
  const minutes = Math.round(sec / 60);
  if (minutes < 1) return `약 ${sec}초`;
  return `약 ${minutes}분`;
}

/** 이미 허용된 알림 권한이 있을 때만 조용히 알림을 보낸다. 요청(request)은 하지 않는다. */
function notifyIfPermitted(
  notificationApi: typeof Notification | undefined,
  title: string,
  body: string,
): void {
  const Impl = notificationApi ?? (typeof Notification !== 'undefined' ? Notification : undefined);
  if (!Impl) return;
  try {
    if (Impl.permission === 'granted') {
      new Impl(title, { body });
    }
  } catch {
    // 알림 발송은 부가 기능이며 실패해도 핵심 흐름에 영향을 주지 않는다.
  }
}

/** 분석 진행 상태를 표시하고, 완료 시 자동 갱신·알림을 수행하는 컴포넌트. */
export function AnalysisStatus({
  tastingId,
  initialStatus,
  fetchStatus,
  onCompleted,
  pollIntervalMs = 5000,
  notificationApi,
}: AnalysisStatusProps) {
  const [status, setStatus] = useState<JobStatus>(initialStatus);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const notifiedRef = useRef(false);
  const { runWriteAction } = useWriteAction({
    formId: `reanalyze-${tastingId}`,
  });

  // 완료/실패 전까지 폴링하고, 언마운트 시 인터벌을 정리한다.
  useEffect(() => {
    if (!IN_PROGRESS_STATUSES.includes(status)) return;

    let cancelled = false;
    const intervalId = setInterval(() => {
      void fetchStatus(tastingId).then((result) => {
        if (cancelled) return;
        setStatus(result.status);
      });
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [status, tastingId, fetchStatus, pollIntervalMs]);

  // 완료 감지 시 1회만 갱신 콜백 + 알림을 실행한다.
  useEffect(() => {
    if (status === 'completed' && !notifiedRef.current) {
      notifiedRef.current = true;
      onCompleted?.();
      notifyIfPermitted(notificationApi, '와간다 분석 완료', '시음 분석이 완료되었습니다.');
    }
  }, [status, onCompleted, notificationApi]);

  async function handleReanalyze(): Promise<void> {
    setIsReanalyzing(true);
    setReanalyzeError(null);
    try {
      const response = await runWriteAction(`/api/tastings/${tastingId}/analyze`, {
        method: 'POST',
      });
      if (!response.ok && response.status !== 401) {
        setReanalyzeError('재분석 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      if (response.ok) {
        setStatus('queued');
        notifiedRef.current = false;
      }
    } finally {
      setIsReanalyzing(false);
    }
  }

  const estimated = ESTIMATED_SEC_BY_STATUS[status];

  return (
    <div className="card space-y-2 p-4" data-testid="analysis-status" data-status={status}>
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span aria-hidden="true">{STATUS_ICON[status]}</span>
        <span className="text-sm font-medium text-cream-100">{STATUS_LABEL[status]}</span>
      </div>

      {IN_PROGRESS_STATUSES.includes(status) && estimated > 0 && (
        <p className="text-xs text-muted">예상 소요 시간: {formatEstimatedSec(estimated)}</p>
      )}

      {status === 'failed' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-burgundy-300">
            분석 중 오류가 발생했습니다. 원본 오디오와 와인 정보는 보존되어 있습니다.
          </p>
          <EditorOnly>
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={isReanalyzing}
              aria-label="재분석 요청"
              className="rounded-md bg-burgundy-700 px-4 py-2 text-sm font-medium text-cream-50 disabled:opacity-50"
            >
              {isReanalyzing ? '요청 중…' : '재분석'}
            </button>
          </EditorOnly>
          {reanalyzeError && (
            <p role="alert" className="text-sm text-burgundy-300">
              {reanalyzeError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
