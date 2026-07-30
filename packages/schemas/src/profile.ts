import { z } from 'zod';
import { EntityId, entityMetaShape } from './common';
import { TastingNotesAverage } from './analysis';

/** 프로파일 활성화 최소 시음 건수 (R7) */
export const PROFILE_MIN_TASTINGS = 5;
/** 표본이 이 값 미만인 속성은 "참고" 등급으로 표기한다 */
export const PROFILE_REFERENCE_SAMPLE_THRESHOLD = 3;

/** 선호/비선호 속성 항목 */
export const ProfileAttribute = z.object({
  /** 속성 축 (품종·지역·가격대 등) */
  dimension: z.string().min(1).max(40),
  key: z.string().min(1).max(120),
  /** 표본 수 */
  n: z.number().int().min(0),
  /** 평균 평점 */
  meanRating: z.number().min(0).max(5),
  /** 표본 3건 미만이면 'reference' */
  grade: z.enum(['solid', 'reference']),
});
export type ProfileAttribute = z.infer<typeof ProfileAttribute>;

/** 추천 와인 유형 */
export const Recommendation = z.object({
  label: z.string().min(1).max(200),
  reason: z.string().min(1).max(600),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** 월별 반응 일치도 추이 포인트 */
export const AgreementPoint = z.object({
  /** YYYY-MM */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  meanScore: z.number().min(0).max(100),
  n: z.number().int().min(0),
});
export type AgreementPoint = z.infer<typeof AgreementPoint>;

export const TasteProfile = z.object({
  type: z.literal('PROFILE'),
  /** 5건 미달이면 false */
  active: z.boolean(),
  tastingCount: z.number().int().min(0),
  /** 비활성 시 진행률 0~1 */
  progress: z.number().min(0).max(1),
  /** 5축 평균 — 집계값이므로 0.5 단위 제약이 없다 */
  axes: TastingNotesAverage.partial().optional(),
  liked: z.array(ProfileAttribute).default([]),
  disliked: z.array(ProfileAttribute).default([]),
  keywords: z.array(z.string().min(1).max(40)).max(20).default([]),
  /** 에이전트가 생성한 서술 */
  narrative: z.string().max(4000).optional(),
  recommendations: z.array(Recommendation).max(5).default([]),
  /** 와인샵용 한 줄 구매 가이드 */
  shoppingGuide: z.string().max(600).optional(),
  agreementTrend: z.array(AgreementPoint).default([]),
  promptVersion: z.string().optional(),
  modelId: z.string().optional(),
  ...entityMetaShape,
});
export type TasteProfile = z.infer<typeof TasteProfile>;

/** 취향 적합도 뱃지 (R7) */
export const FitLevel = z.enum(['perfect', 'challenging', 'dislike', 'unknown']);
export type FitLevel = z.infer<typeof FitLevel>;

export const FitAssessment = z.object({
  level: FitLevel,
  reason: z.string().max(600),
  wineId: EntityId.optional(),
});
export type FitAssessment = z.infer<typeof FitAssessment>;
