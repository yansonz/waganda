'use client';

import { useRef, useState, type ReactElement } from 'react';
import type { MappingConfidence, Persona, TranscriptSegment } from '@waganda/schemas';
import { TranscriptView } from './TranscriptView';

/**
 * components/tasting/AudioPlayer.tsx — 오디오 플레이어 + 트랜스크립트 연동 (14.3, R9).
 *
 * `<audio>` 의 `timeupdate` 이벤트로 현재 재생 위치를 추적해 TranscriptView 에 전달한다.
 * 트랜스크립트 구간 클릭 시 해당 시각으로 이동(seek)한다.
 */
interface AudioPlayerProps {
  /** 오디오 CDN 경로 (예: /media/recordings/...) */
  src: string;
  segments: TranscriptSegment[];
  mapping: { speaker_1: Persona; speaker_2: Persona } | null;
  mappingConfidence: MappingConfidence;
}

export function AudioPlayer({
  src,
  segments,
  mapping,
  mappingConfidence,
}: AudioPlayerProps): ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);

  function handleTimeUpdate(): void {
    const audio = audioRef.current;
    if (audio) setCurrentTimeSec(audio.currentTime);
  }

  function handleSeek(atSec: number): void {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = atSec;
      audio.play().catch(() => {
        // 자동재생이 브라우저 정책으로 막혀도 조용히 무시한다 — 사용자가 직접 재생 버튼을 누를 수 있다.
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        src={src}
        controls
        onTimeUpdate={handleTimeUpdate}
        className="w-full"
        aria-label="시음 녹음 오디오 플레이어"
      >
        브라우저가 오디오 재생을 지원하지 않습니다.
      </audio>
      <TranscriptView
        segments={segments}
        currentTimeSec={currentTimeSec}
        mapping={mapping}
        mappingConfidence={mappingConfidence}
        onSeek={handleSeek}
      />
    </div>
  );
}
