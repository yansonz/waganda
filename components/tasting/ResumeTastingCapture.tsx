'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { EditorOnly } from '@/components/auth/EditorSession';

interface ResumeTastingCaptureProps {
  tastingId: string;
  hasWine: boolean;
  recordingCount: number;
}

/** 입력이 하나 비어 있는 캡처만 편집자에게 `/record` 재개 링크를 노출한다. */
export function ResumeTastingCapture({
  tastingId,
  hasWine,
  recordingCount,
}: ResumeTastingCaptureProps): ReactElement | null {
  const needsWine = !hasWine && recordingCount > 0;
  const needsAudio = hasWine && recordingCount === 0;

  if (!needsWine && !needsAudio) return null;

  return (
    <EditorOnly>
      <aside className="rounded-lg border border-gold-500/30 bg-ink-900/60 p-3 text-sm">
        <p className="text-cream-100">
          {needsWine
            ? '녹음은 저장되었습니다. 라벨 사진이나 와인 이름을 연결하면 분석을 시작합니다.'
            : '와인 정보는 저장되었습니다. 반응 녹음을 이어서 남길 수 있습니다.'}
        </p>
        <Link
          href={`/record?resume=${encodeURIComponent(tastingId)}`}
          className="mt-2 inline-block text-gold-300 hover:underline"
        >
          {needsWine ? '라벨 사진 연결하기' : '녹음 이어하기'}
        </Link>
      </aside>
    </EditorOnly>
  );
}
