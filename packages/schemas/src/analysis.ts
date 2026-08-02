import { z } from 'zod';
import { EntityId, NoteAxisValue, Persona, Rating, entityMetaShape } from './common';

/**
 * 모델이 JSON 문자열 값 안에 리터럴 이스케이프(`\"`, `\\`)를 그대로 생성하는 결함을
 * 방어적으로 정리한다. Bedrock/Claude 가 인용부호를 강조하려다 이스케이프 문자
 * 자체를 텍스트 콘텐츠로 남기는 사례가 실측됐다(예: `\"19 Crimes\"` 가 화면에 그대로 노출).
 * 정상적인 한국어 문장에는 백슬래시가 나타나지 않으므로 무조건 제거해도 안전하다.
 */
function sanitizeModelText(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

/** 5축 시음 노트 */
export const TastingNotes = z.object({
  acidity: NoteAxisValue,
  tannin: NoteAxisValue,
  body: NoteAxisValue,
  aroma: NoteAxisValue,
  finish: NoteAxisValue,
});
export type TastingNotes = z.infer<typeof TastingNotes>;

export const NoteAxis = z.enum(['acidity', 'tannin', 'body', 'aroma', 'finish']);
export type NoteAxis = z.infer<typeof NoteAxis>;

/**
 * 5축 **평균값**. 개별 노트(`TastingNotes`)는 0.5 단위지만
 * 여러 시음의 평균은 임의의 실수가 되므로 단위 제약을 걸지 않는다.
 * (취향 프로파일의 `axes` 처럼 집계 결과에 쓴다)
 */
export const TastingNotesAverage = z.object({
  acidity: z.number().min(1).max(5),
  tannin: z.number().min(1).max(5),
  body: z.number().min(1).max(5),
  aroma: z.number().min(1).max(5),
  finish: z.number().min(1).max(5),
});
export type TastingNotesAverage = z.infer<typeof TastingNotesAverage>;

/** 하이라이트 — 실제 발화 인용과 해석 */
export const Highlight = z.object({
  quote: z.string().min(1).max(1000).transform(sanitizeModelText),
  note: z.string().min(1).max(1000).transform(sanitizeModelText),
  atSec: z.number().min(0).optional(),
  speaker: z.union([Persona, z.enum(['speaker_1', 'speaker_2'])]).optional(),
});
export type Highlight = z.infer<typeof Highlight>;

/** R6: 모든 판단 항목은 근거를 동반해야 한다 */
export const Evidence = z.object({
  field: z.string().min(1).max(60),
  basis: z.string().min(1).max(1000),
  /** 근거 종류 — 발화 인용 또는 음향 신호 */
  kind: z.enum(['quote', 'acoustic', 'history']),
  atSec: z.number().min(0).optional(),
});
export type Evidence = z.infer<typeof Evidence>;

/** 화자별 감정 강도·평가 방향 (반응 일치도 산출 입력) */
export const SpeakerReaction = z.object({
  /** 감정 강도 0~1 */
  intensity: z.number().min(0).max(1),
  /** 평가 방향 -1(부정) ~ +1(긍정) */
  valence: z.number().min(-1).max(1),
});
export type SpeakerReaction = z.infer<typeof SpeakerReaction>;

/**
 * 소믈리에 에이전트의 구조화 출력. 위반 시 최대 2회 재생성한다 (R6).
 * 저장 레코드가 아니라 모델 출력 계약이다.
 */
export const SommelierOutput = z.object({
  summary: z.string().min(1).max(4000).transform(sanitizeModelText),
  /**
   * 인용할 발화가 없으면(무음 녹음) 빈 배열이 될 수 있다.
   * R5: 무음은 실패가 아니라 해석 입력이다 — 없는 인용을 만들게 하지 않는다.
   */
  highlights: z.array(Highlight).max(10),
  /** 발화가 없어 평점을 낼 수 없으면 생략한다 */
  aiRating: Rating.optional(),
  /** 5축 판단 근거가 없으면 생략한다 (축별 부분 판단도 허용) */
  notes: TastingNotes.partial().optional(),
  evidence: z.array(Evidence).min(1).max(30),
  /** 화자 매핑 신뢰도가 none 이면 생략 (R5) */
  speakerContrast: z.string().max(2000).transform(sanitizeModelText).optional(),
  /** 같은 와인·유사 와인 과거 기록 대비 변화 */
  comparisonToPast: z.string().max(2000).transform(sanitizeModelText).optional(),
  /** 화자별 반응 — 두 화자가 구분된 경우에만 */
  reactions: z.object({ speaker_1: SpeakerReaction, speaker_2: SpeakerReaction }).optional(),
  /** 감정 타임라인 (UI 차트용) */
  emotionTimeline: z
    .array(z.object({ atSec: z.number().min(0), intensity: z.number().min(0).max(1) }))
    .max(600)
    .optional(),
});
export type SommelierOutput = z.infer<typeof SommelierOutput>;

/** 저장되는 분석 레코드 */
export const Analysis = z.object({
  type: z.literal('ANALYSIS'),
  tastingId: EntityId,
  summary: z.string().transform(sanitizeModelText),
  highlights: z.array(Highlight),
  /** 발화가 없어 평점을 낼 수 없었던 기록은 비어 있을 수 있다 */
  aiRating: Rating.optional(),
  notes: TastingNotes.partial().optional(),
  evidence: z.array(Evidence),
  speakerContrast: z.string().transform(sanitizeModelText).optional(),
  comparisonToPast: z.string().transform(sanitizeModelText).optional(),
  reactions: z.object({ speaker_1: SpeakerReaction, speaker_2: SpeakerReaction }).optional(),
  emotionTimeline: z
    .array(z.object({ atSec: z.number().min(0), intensity: z.number().min(0).max(1) }))
    .optional(),
  /** 0~100 반응 일치도 — 두 화자 구분 시에만 */
  agreementScore: z.number().min(0).max(100).optional(),
  /** 사용자 수정본 — 원본(summary/highlights)은 보존한다 */
  editedSummary: z.string().transform(sanitizeModelText).optional(),
  editedHighlights: z.array(Highlight).optional(),
  promptVersion: z.string().min(1),
  modelId: z.string().min(1),
  traceId: z.string().optional(),
  ...entityMetaShape,
});
export type Analysis = z.infer<typeof Analysis>;
