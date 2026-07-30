'use client';

/**
 * components/record/UploadStatus.tsx — 업로드 진행·실패·재시도 UI.
 *
 * requirements.md R2: "네트워크 중단으로 업로드가 실패하면 녹음 데이터를 브라우저에
 * 보존하고 재시도 버튼을 제공한다". `lib/upload/resume.ts` 의 상태를 화면에 표시하고
 * 수동 재시도를 트리거한다.
 *
 * 접근성: 상태 텍스트는 색상과 함께 아이콘·문구로도 구분한다(색상만으로 정보 전달 금지).
 */
import type { UploadItemMeta } from '@/lib/upload/resume';

export interface UploadStatusProps {
  item: UploadItemMeta;
  /** 재시도 버튼 클릭 시 호출 */
  onRetry: (recordingId: string) => void;
  /** 재시도 진행 중 여부 (버튼 비활성화용) */
  isRetrying?: boolean;
}

const STATUS_LABEL: Record<UploadItemMeta['status'], string> = {
  pending: '대기 중',
  uploading: '업로드 중',
  failed: '업로드 실패',
  succeeded: '업로드 완료',
};

const STATUS_ICON: Record<UploadItemMeta['status'], string> = {
  pending: '⏳',
  uploading: '⬆️',
  failed: '⚠️',
  succeeded: '✅',
};

/** 단일 녹음의 업로드 상태를 표시하고, 실패 시 재시도 버튼을 제공한다. */
export function UploadStatus({ item, onRetry, isRetrying = false }: UploadStatusProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-ink-700 p-3"
      data-testid={`upload-status-${item.recordingId}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{STATUS_ICON[item.status]}</span>
        <div>
          <p className="text-sm font-medium text-cream-100">
            <span className="sr-only">업로드 상태: </span>
            {STATUS_LABEL[item.status]}
          </p>
          {item.status === 'failed' && item.lastError && (
            <p role="alert" className="text-xs text-burgundy-300">
              {item.lastError}
            </p>
          )}
        </div>
      </div>

      {item.status === 'failed' && (
        <button
          type="button"
          onClick={() => onRetry(item.recordingId)}
          disabled={isRetrying}
          aria-label="업로드 재시도"
          className="rounded-md bg-burgundy-700 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50"
        >
          {isRetrying ? '재시도 중…' : '재시도'}
        </button>
      )}
    </div>
  );
}

export interface UploadStatusListProps {
  items: UploadItemMeta[];
  onRetry: (recordingId: string) => void;
  retryingIds?: Set<string>;
}

/** 여러 업로드 항목의 상태를 목록으로 표시한다. */
export function UploadStatusList({ items, onRetry, retryingIds }: UploadStatusListProps) {
  if (items.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label="업로드 상태 목록">
      {items.map((item) => (
        <li key={item.recordingId}>
          <UploadStatus
            item={item}
            onRetry={onRetry}
            isRetrying={retryingIds?.has(item.recordingId)}
          />
        </li>
      ))}
    </ul>
  );
}
