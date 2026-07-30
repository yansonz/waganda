import type { ReactElement } from 'react';
import type { Highlight, MappingConfidence, Persona } from '@waganda/schemas';
import { speakerDisplayLabel, type SpeakerKey } from './speakerLabel';

/**
 * components/tasting/HighlightList.tsx — 반응 하이라이트 목록 (R9).
 *
 * 인용(quote)과 해석(note)을 말풍선 형태로 나열한다. 화자 표시는 매핑 신뢰도를 반영한다.
 */
interface HighlightListProps {
  highlights: Highlight[];
  mapping: { speaker_1: Persona; speaker_2: Persona } | null;
  mappingConfidence: MappingConfidence;
}

export function HighlightList({
  highlights,
  mapping,
  mappingConfidence,
}: HighlightListProps): ReactElement {
  if (highlights.length === 0) {
    return (
      <p role="status" className="text-muted text-sm">
        하이라이트가 없습니다.
      </p>
    );
  }

  return (
    <ul aria-label="반응 하이라이트" className="flex flex-col gap-3">
      {highlights.map((highlight, index) => {
        const label =
          highlight.speaker &&
          (highlight.speaker === 'speaker_1' || highlight.speaker === 'speaker_2')
            ? speakerDisplayLabel(highlight.speaker as SpeakerKey, mapping, mappingConfidence)
            : highlight.speaker;

        return (
          <li key={index} className="card p-3">
            {label && <p className="text-gold-400 mb-1 text-xs font-semibold">{label}</p>}
            <p className="text-cream-100 italic">&ldquo;{highlight.quote}&rdquo;</p>
            <p className="text-muted mt-1 text-sm">{highlight.note}</p>
          </li>
        );
      })}
    </ul>
  );
}
