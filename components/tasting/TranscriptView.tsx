'use client';

import type { ReactElement } from 'react';
import type { MappingConfidence, Persona, TranscriptSegment } from '@waganda/schemas';
import { speakerDisplayLabel, type SpeakerKey } from './speakerLabel';

/**
 * components/tasting/TranscriptView.tsx — 트랜스크립트 구간 표시 (14.3, R9).
 *
 * `currentTimeSec` 이 구간 [start, end) 에 속하면 해당 구간을 강조한다.
 * 강조는 배경색뿐 아니라 aria-current 로도 전달해 색상만으로 정보를 주지 않는다.
 */
interface TranscriptViewProps {
  segments: TranscriptSegment[];
  /** 현재 오디오 재생 위치(초). 지정하지 않으면 강조를 표시하지 않는다. */
  currentTimeSec?: number;
  mapping: { speaker_1: Persona; speaker_2: Persona } | null;
  mappingConfidence: MappingConfidence;
  /** 구간 클릭 시 해당 시각으로 이동시키는 콜백 (오디오 플레이어 연동) */
  onSeek?: (atSec: number) => void;
}

function isActiveSegment(segment: TranscriptSegment, currentTimeSec: number | undefined): boolean {
  if (currentTimeSec === undefined) return false;
  return currentTimeSec >= segment.start && currentTimeSec < segment.end;
}

export function TranscriptView({
  segments,
  currentTimeSec,
  mapping,
  mappingConfidence,
  onSeek,
}: TranscriptViewProps): ReactElement {
  if (segments.length === 0) {
    return (
      <p role="status" className="text-muted text-sm">
        트랜스크립트가 없습니다.
      </p>
    );
  }

  return (
    <ol aria-label="시음 대화 트랜스크립트" className="flex flex-col gap-2">
      {segments.map((segment, index) => {
        const active = isActiveSegment(segment, currentTimeSec);
        const label = segment.speaker
          ? speakerDisplayLabel(segment.speaker as SpeakerKey, mapping, mappingConfidence)
          : undefined;

        return (
          <li key={`${segment.start}-${index}`}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSeek?.(segment.start)}
              className={`w-full rounded-md p-2 text-left transition-colors ${
                active ? 'bg-burgundy-700/40 border border-gold-500/50' : 'hover:bg-ink-800'
              }`}
            >
              {label && <span className="text-gold-400 mr-2 text-xs font-semibold">{label}</span>}
              <span className="text-cream-100">{segment.text}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
