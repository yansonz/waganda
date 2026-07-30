/**
 * lib/domain/speaker.ts — 화자 매핑 (R5)
 *
 * 절대 주파수 임계값은 개인차·녹음환경에 취약하므로, 같은 녹음 안 두 화자의
 * "상대 비교"만 사용한다. 오디오 Lambda가 세션 A에서 이미 계산한 F0 트랙을
 * 화자 구간으로 슬라이스만 하며, 오디오 Lambda를 재호출하지 않는다.
 */
import type {
  F0Point,
  MappingConfidence,
  Persona,
  SpeakerMapping,
  SpeakerSegment,
} from '@waganda/schemas';

/** 화자 매핑 gap 임계값 (Hz) — design.md '화자 매핑' 절 그대로 */
export const SPEAKER_GAP_HIGH_THRESHOLD_HZ = 60;
export const SPEAKER_GAP_MEDIUM_THRESHOLD_HZ = 30;

/**
 * F0 트랙을 화자 구간들로 슬라이스해 무성 프레임(hz=0)을 제외한 표본으로
 * 중앙값을 계산한다. 표본이 없으면 null.
 */
function medianF0ForSegments(f0Track: F0Point[], segments: SpeakerSegment[]): number | null {
  const values: number[] = [];
  for (const seg of segments) {
    for (const point of f0Track) {
      // 무성 프레임(hz=0)은 표본에서 제외한다
      if (point.hz <= 0) continue;
      if (point.t >= seg.start && point.t <= seg.end) {
        values.push(point.hz);
      }
    }
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * F0 트랙과 화자 구간으로부터 화자 매핑을 결정한다.
 *
 * 판정 규칙:
 * - 두 화자 모두 F0 표본이 있고 gap >= 60Hz → 낮은 쪽 yan, 높은 쪽 robert, confidence 'high'
 * - 30 <= gap < 60 → 동일 매핑(낮은 쪽 yan, 높은 쪽 robert), confidence 'medium'
 * - gap < 30 → 매핑 없음(null), confidence 'none'
 * - 단일 화자(구간에 화자가 1종류뿐) 또는 한쪽 이상 F0 표본 결측 → 매핑 없음(null), confidence 'none'
 *
 * 오디오 Lambda를 재호출하지 않는다 — 이미 계산된 f0Track 을 그대로 슬라이스한다.
 */
export function mapSpeakers(f0Track: F0Point[], segments: SpeakerSegment[]): SpeakerMapping {
  const speakerKinds = new Set(segments.map((s) => s.speaker));

  // 단일 화자 — 화자가 1종류뿐이면 매핑을 시도하지 않는다
  if (speakerKinds.size < 2) {
    return {
      segments,
      mapping: null,
      mappingConfidence: 'none',
      manuallyOverridden: false,
    };
  }

  const speaker1Segments = segments.filter((s) => s.speaker === 'speaker_1');
  const speaker2Segments = segments.filter((s) => s.speaker === 'speaker_2');

  const medianSpeaker1 = medianF0ForSegments(f0Track, speaker1Segments);
  const medianSpeaker2 = medianF0ForSegments(f0Track, speaker2Segments);

  // F0 결측 — 무성 프레임 제외 후 한쪽이라도 표본이 없으면 매핑 불가
  if (medianSpeaker1 === null || medianSpeaker2 === null) {
    return {
      segments,
      mapping: null,
      mappingConfidence: 'none',
      manuallyOverridden: false,
      medianF0: {
        speaker_1: medianSpeaker1,
        speaker_2: medianSpeaker2,
        gapHz: null,
      },
    };
  }

  const gap = Math.abs(medianSpeaker1 - medianSpeaker2);
  let mapping: { speaker_1: Persona; speaker_2: Persona } | null = null;
  let mappingConfidence: MappingConfidence;

  if (gap >= SPEAKER_GAP_HIGH_THRESHOLD_HZ) {
    mapping = lowerIsYan(medianSpeaker1, medianSpeaker2);
    mappingConfidence = 'high';
  } else if (gap >= SPEAKER_GAP_MEDIUM_THRESHOLD_HZ) {
    mapping = lowerIsYan(medianSpeaker1, medianSpeaker2);
    mappingConfidence = 'medium';
  } else {
    mapping = null;
    mappingConfidence = 'none';
  }

  return {
    segments,
    mapping,
    mappingConfidence,
    manuallyOverridden: false,
    medianF0: {
      speaker_1: medianSpeaker1,
      speaker_2: medianSpeaker2,
      gapHz: gap,
    },
  };
}

/** 낮은 F0 쪽을 yan(남성), 높은 쪽을 robert(여성)으로 매핑한다 */
function lowerIsYan(
  medianSpeaker1: number,
  medianSpeaker2: number,
): { speaker_1: Persona; speaker_2: Persona } {
  if (medianSpeaker1 <= medianSpeaker2) {
    return { speaker_1: 'yan', speaker_2: 'robert' };
  }
  return { speaker_1: 'robert', speaker_2: 'yan' };
}
