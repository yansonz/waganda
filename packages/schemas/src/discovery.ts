import { z } from 'zod';
import { EntityId, entityMetaShape } from './common';

/** 발견 신뢰 등급 */
export const DiscoveryGrade = z.enum(['weak', 'moderate', 'strong']);
export type DiscoveryGrade = z.infer<typeof DiscoveryGrade>;

/** 발견 실행 최소 시음 건수 / 증가폭 (R8) */
export const DISCOVERY_MIN_TASTINGS = 10;
export const DISCOVERY_MIN_INCREMENT = 5;

/** 등급 판정 임계값 — 코드로 고정한다 */
export const DISCOVERY_THRESHOLDS = {
  minSampleSize: 4,
  minAbsDelta: 0.5,
  strong: { n: 6, delta: 1.0 },
  moderate: { n: 5, delta: 0.7 },
} as const;

/** 우연 가능성 문구 — 모든 카드에 함께 표시한다 */
export const CHANCE_DISCLAIMER = '표본이 적어 우연일 수 있습니다. 기록이 쌓이면 다시 판정합니다.';

export const Discovery = z.object({
  id: EntityId,
  type: z.literal('DISCOVERY'),
  /** 중복 차단 키의 축 */
  groupBy: z.string().min(1).max(40),
  /** 중복 차단 키의 값 */
  key: z.string().min(1).max(120),
  /** 재미있는 별칭 */
  alias: z.string().min(1).max(120),
  /** 패턴 서술 */
  description: z.string().min(1).max(2000),
  metric: z.string().min(1).max(40),
  n: z.number().int().min(0),
  value: z.number(),
  deltaVsOverall: z.number(),
  grade: DiscoveryGrade,
  /** 근거 시음 링크 */
  evidenceTastingIds: z.array(EntityId).max(50).default([]),
  disclaimer: z.string().default(CHANCE_DISCLAIMER),
  hidden: z.boolean().default(false),
  /** 표본이 늘어 갱신된 경우 알림 대상 */
  updatedFromN: z.number().int().min(0).optional(),
  promptVersion: z.string().optional(),
  modelId: z.string().optional(),
  ...entityMetaShape,
});
export type Discovery = z.infer<typeof Discovery>;

/** 에이전트가 제안하는 발견 후보 (등급은 코드가 판정) */
export const DiscoveryCandidate = z.object({
  groupBy: z.string().min(1).max(40),
  key: z.string().min(1).max(120),
  alias: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  metric: z.string().min(1).max(40),
  n: z.number().int().min(0),
  value: z.number(),
  deltaVsOverall: z.number(),
  evidenceTastingIds: z.array(EntityId).max(50).default([]),
});
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidate>;
