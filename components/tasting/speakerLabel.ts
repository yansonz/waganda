import type { MappingConfidence, Persona } from '@waganda/schemas';

/**
 * components/tasting/speakerLabel.ts — 화자 표시 이름 계산 (순수 함수, 14.3/14.9).
 *
 * R5/R9: 화자 매핑 신뢰도가 'none'(불확실)이면 실명(yan/robert)을 노출하지 않고
 * speaker_1/speaker_2 형태의 중립적 번호만 표시한다.
 */
export type SpeakerKey = 'speaker_1' | 'speaker_2';

const SPEAKER_DISPLAY_NUMBER: Record<SpeakerKey, string> = {
  speaker_1: '화자 1',
  speaker_2: '화자 2',
};

const PERSONA_DISPLAY_NAME: Record<Persona, string> = {
  yan: 'Yan',
  robert: 'Robert',
};

/**
 * 화자 키(speaker_1/speaker_2)를 표시용 라벨로 변환한다.
 * mappingConfidence 가 'none' 이면 매핑이 있어도 실명을 쓰지 않는다.
 */
export function speakerDisplayLabel(
  speaker: SpeakerKey,
  mapping: { speaker_1: Persona; speaker_2: Persona } | null,
  mappingConfidence: MappingConfidence,
): string {
  if (mappingConfidence === 'none' || !mapping) {
    return SPEAKER_DISPLAY_NUMBER[speaker];
  }
  return PERSONA_DISPLAY_NAME[mapping[speaker]];
}
