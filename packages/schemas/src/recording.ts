import { z } from 'zod';
import { AudioFormat, EntityId, MappingConfidence, Persona, entityMetaShape } from './common';

/** 시간 구간 (초) */
export const TimeRange = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
});
export type TimeRange = z.infer<typeof TimeRange>;

/** F0 트랙 포인트 */
export const F0Point = z.object({
  t: z.number().min(0),
  hz: z.number().min(0),
});
export type F0Point = z.infer<typeof F0Point>;

/**
 * 오디오 Lambda(Python) 출력. `audio/handler.py` 의 반환 형태와 1:1 대응한다.
 */
export const Acoustic = z.object({
  /** 프레임 단위 RMS 에너지 곡선 */
  rmsCurve: z.array(z.number().min(0)),
  /** RMS 프레임 간격(초) */
  frameSec: z.number().gt(0),
  /** F0 트랙 (무성 구간은 hz=0) */
  f0Track: z.array(F0Point),
  /** 0.8초 이상 침묵 구간 */
  silences: z.array(TimeRange),
  /** 발화 속도 — 유성 구간 기준 초당 음절 근사치 */
  speechRate: z.number().min(0),
  /** 웃음 후보 구간 (휴리스틱, 평점 근거로 쓰지 않는다) */
  laughterCandidates: z.array(TimeRange),
  /** 전체 길이(초) */
  durationSec: z.number().min(0),
});
export type Acoustic = z.infer<typeof Acoustic>;

/** Transcribe 화자분리 결과 구간 */
export const SpeakerSegment = z.object({
  speaker: z.enum(['speaker_1', 'speaker_2']),
  start: z.number().min(0),
  end: z.number().min(0),
});
export type SpeakerSegment = z.infer<typeof SpeakerSegment>;

/** 화자 실명 매핑 결과 */
export const SpeakerMapping = z.object({
  segments: z.array(SpeakerSegment),
  mapping: z.object({ speaker_1: Persona, speaker_2: Persona }).nullable(),
  mappingConfidence: MappingConfidence,
  /** 매핑 근거 — 화자별 F0 중앙값과 그 차이 */
  medianF0: z
    .object({
      speaker_1: z.number().min(0).nullable(),
      speaker_2: z.number().min(0).nullable(),
      gapHz: z.number().min(0).nullable(),
    })
    .optional(),
  /** 편집자가 수동 교체했는지 */
  manuallyOverridden: z.boolean().default(false),
});
export type SpeakerMapping = z.infer<typeof SpeakerMapping>;

/** 트랜스크립트 발화 단위 */
export const TranscriptSegment = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  speaker: z.enum(['speaker_1', 'speaker_2']).optional(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const Transcript = z.object({
  language: z.string().default('ko-KR'),
  fullText: z.string(),
  segments: z.array(TranscriptSegment),
});
export type Transcript = z.infer<typeof Transcript>;

export const Recording = z.object({
  id: EntityId,
  type: z.literal('RECORDING'),
  tastingId: EntityId,
  audioKey: z.string().min(1).max(512),
  durationSec: z.number().min(0).max(36_000),
  format: AudioFormat,
  sizeBytes: z.number().int().min(0).optional(),
  /** Transcribe 출력 S3 키 */
  transcriptKey: z.string().min(1).max(512).optional(),
  transcript: Transcript.optional(),
  acoustic: Acoustic.optional(),
  speakers: SpeakerMapping.optional(),
  ...entityMetaShape,
});
export type Recording = z.infer<typeof Recording>;

/** POST /api/tastings/[id]/recordings 요청 */
export const RecordingUploadRequest = z.object({
  format: AudioFormat,
  durationSec: z.number().min(0).max(36_000),
  sizeBytes: z.number().int().min(0),
});
export type RecordingUploadRequest = z.infer<typeof RecordingUploadRequest>;

export const RecordingUploadResponse = z.object({
  recordingId: EntityId,
  uploadUrl: z.url(),
  audioKey: z.string(),
  expiresInSec: z.number().int().positive(),
});
export type RecordingUploadResponse = z.infer<typeof RecordingUploadResponse>;

/** PATCH /api/recordings/[id]/speakers — 오판 정정 (두 화자 교체) */
export const SpeakerOverrideRequest = z.object({
  mapping: z.object({ speaker_1: Persona, speaker_2: Persona }).nullable(),
});
export type SpeakerOverrideRequest = z.infer<typeof SpeakerOverrideRequest>;

/** 녹음 개수 상한 (세션당) */
export const MAX_RECORDINGS_PER_TASTING = 3;
/** 업로드 크기 상한 (50MB) */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
/** 업로드 길이 상한 (10분) */
export const MAX_AUDIO_SEC = 10 * 60;
