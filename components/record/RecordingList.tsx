'use client';

/**
 * components/record/RecordingList.tsx — 녹음 목록 (세션당 최대 3개 상한 안내).
 *
 * requirements.md R2: "하나의 시음 세션에 최대 3개의 녹음을 첨부할 수 있게 한다".
 * `MAX_RECORDINGS_PER_TASTING` 을 스키마에서 가져와 상한을 표시하고, 4번째 녹음
 * 시도 시 거부 안내를 렌더링한다.
 */
import { MAX_RECORDINGS_PER_TASTING } from '@waganda/schemas';

export interface RecordingListItem {
  id: string;
  /** 녹음 길이(초) */
  durationSec: number;
  /** 표시용 파일명 또는 순번 라벨 */
  label: string;
}

export interface RecordingListProps {
  items: RecordingListItem[];
  onRemove?: (id: string) => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 녹음 목록과 세션당 상한(최대 3개) 안내를 함께 표시한다.
 * 상한에 도달하면 안내 문구가 강조 표시되고, 초과 시도는 상위 컴포넌트가
 * 차단한 뒤 이 컴포넌트로 거부 사유를 전달해 표시한다.
 */
export function RecordingList({ items, onRemove }: RecordingListProps) {
  const atLimit = items.length >= MAX_RECORDINGS_PER_TASTING;

  return (
    <div className="space-y-2" data-testid="recording-list">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-cream-100">첨부된 녹음</h3>
        <p
          className="text-xs text-muted"
          aria-label={`녹음 ${items.length}개 중 최대 ${MAX_RECORDINGS_PER_TASTING}개`}
        >
          {items.length} / {MAX_RECORDINGS_PER_TASTING}
        </p>
      </div>

      {items.length === 0 && <p className="text-sm text-muted">아직 첨부된 녹음이 없습니다.</p>}

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-md border border-ink-700 px-3 py-2"
            >
              <span className="text-sm text-cream-100">
                {item.label} · {formatDuration(item.durationSec)}
              </span>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`${item.label} 삭제`}
                  className="text-sm text-burgundy-300 underline"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {atLimit && (
        <p role="status" className="text-sm text-gold-400">
          ⚠ 세션당 녹음은 최대 {MAX_RECORDINGS_PER_TASTING}개까지 첨부할 수 있습니다. 추가 녹음을
          첨부하려면 기존 녹음을 삭제해 주세요.
        </p>
      )}
    </div>
  );
}
