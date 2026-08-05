'use client';

import type { ReactElement } from 'react';
import { SERVICE_TIME_ZONE } from '@/lib/domain/types';

export interface IncompleteCapture {
  tastingId: string;
  tastedAt: string;
  recordingCount: number;
  kind: 'needs_wine' | 'needs_audio';
  wine?: { wineId: string; name: string; vintage?: number };
}

interface IncompleteCaptureListProps {
  captures: IncompleteCapture[];
  onResume: (capture: IncompleteCapture) => void;
  onDelete?: (capture: IncompleteCapture) => void;
}

function formatTastedAt(tastedAt: string): string {
  return new Date(tastedAt).toLocaleString('ko-KR', {
    timeZone: SERVICE_TIME_ZONE,
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 라벨 또는 녹음이 하나 부족한 시음 캡처를 편집자가 이어 쓰는 카드 목록. */
export function IncompleteCaptureList({ captures, onResume, onDelete }: IncompleteCaptureListProps): ReactElement | null {
  if (captures.length === 0) return null;

  return (
    <section aria-labelledby="incomplete-captures-heading" className="space-y-3">
      <div>
        <h2 id="incomplete-captures-heading" className="text-muted text-sm">
          이어 쓰는 기록
        </h2>
        <p className="text-muted mt-1 text-xs">
          공개 목록에는 보이지 않는 미완성 기록입니다. 필요한 입력을 이어서 남기면 분석을 시작합니다.
        </p>
      </div>
      <ul className="space-y-2">
        {captures.map((capture) => {
          const needsWine = capture.kind === 'needs_wine';
          const wineName = capture.wine
            ? `${capture.wine.name}${capture.wine.vintage ? ` ${capture.wine.vintage}` : ''}`
            : undefined;
          const action = needsWine ? '라벨 사진 연결하기' : '녹음 이어하기';
          return (
            <li key={capture.tastingId} className="rounded-lg border border-gold-500/25 bg-ink-900/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-cream-100">
                    {wineName ?? '와인 정보가 필요합니다'}
                  </p>
                  <p className="text-muted mt-1 text-xs">
                    {formatTastedAt(capture.tastedAt)} ·{' '}
                    {needsWine ? `녹음 ${capture.recordingCount}개 저장됨` : '녹음이 필요함'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onResume(capture)}
                  className="rounded border border-gold-500/40 px-3 py-2 text-sm text-gold-300 hover:bg-gold-500/10"
                >
                  {action}
                </button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(capture)}
                    aria-label={`${wineName ?? '미완성 기록'} 삭제`}
                    className="rounded border border-burgundy-500/40 px-3 py-2 text-sm text-burgundy-300 hover:bg-burgundy-500/10"
                  >
                    삭제
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
