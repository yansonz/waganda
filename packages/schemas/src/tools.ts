import { z } from 'zod';
import { BottleShape, Closure, EntityId, FieldConfidence, LabelTag, WineType } from './common';
import { NoteAxis, TastingNotes } from './analysis';
import { TastingSummary } from './tasting';
import { DiscoveryGrade } from './discovery';

/**
 * 에이전트 도구 입출력 계약. 프레임워크에 의존하지 않는다.
 * Strands 바인딩은 `agent/src/tools/index.ts` 의 얇은 어댑터가 담당한다.
 *
 * 원칙: **LLM 에 노출되는 도구는 전부 읽기 전용이다** (R10).
 */

/* ── computeStats ─────────────────────────────────────────────── */

/** 정통 탐색 축 5개 */
export const CONVENTIONAL_GROUP_BY = [
  'grape',
  'country',
  'region',
  'priceBand',
  'vintageDecade',
] as const;

/** 비전통 탐색 축 7개 — R8 "뜻밖의 발견"의 원천 */
export const UNCONVENTIONAL_GROUP_BY = [
  'labelTag',
  /**
   * 자유 태그 축 — 라벨 모티프("범죄자 초상", "새 그림")와 특징("과실향 강함")을
   * 열린 어휘로 비교한다. 고정 enum(`labelTag`)으로 담을 수 없는 발견이 여기서 나온다.
   */
  'tag',
  'bottleShape',
  'closure',
  'weekday',
  'hourBucket',
  'daysSincePrevTasting',
  'hadLaughter',
  'speakerAgreementBand',
] as const;

export const GroupByAxis = z.enum([...CONVENTIONAL_GROUP_BY, ...UNCONVENTIONAL_GROUP_BY]);
export type GroupByAxis = z.infer<typeof GroupByAxis>;

export const StatsMetric = z.enum(['meanRating', 'ratioAtOrAbove4', 'meanNoteAxis']);
export type StatsMetric = z.infer<typeof StatsMetric>;

/**
 * 임의 코드·SQL 이 아닌 **제한된 스펙**만 받는다.
 * R7·R8 의 계산 도구 요구를 충족하면서 R10 의 질의 안전성을 지키는 방식이다.
 */
export const ComputeStatsSpec = z
  .object({
    groupBy: GroupByAxis,
    metric: StatsMetric,
    noteAxis: NoteAxis.optional(),
    minSampleSize: z.number().int().min(1).max(100).default(4),
  })
  .refine((s) => s.metric !== 'meanNoteAxis' || s.noteAxis !== undefined, {
    message: "metric 이 'meanNoteAxis' 이면 noteAxis 가 필요하다",
    path: ['noteAxis'],
  });
export type ComputeStatsSpec = z.infer<typeof ComputeStatsSpec>;

export const StatsGroup = z.object({
  key: z.string(),
  n: z.number().int().min(0),
  value: z.number(),
  deltaVsOverall: z.number(),
  tastingIds: z.array(EntityId).default([]),
});
export type StatsGroup = z.infer<typeof StatsGroup>;

export const ComputeStatsResult = z.object({
  groups: z.array(StatsGroup),
  overall: z.number(),
  totalN: z.number().int().min(0),
  spec: z.object({
    groupBy: GroupByAxis,
    metric: StatsMetric,
    noteAxis: NoteAxis.optional(),
    minSampleSize: z.number().int(),
  }),
});
export type ComputeStatsResult = z.infer<typeof ComputeStatsResult>;

/* ── 카탈로그 조회 ─────────────────────────────────────────────── */

export const GetWineInput = z.object({ wineId: EntityId });
export type GetWineInput = z.infer<typeof GetWineInput>;

export const WineDetail = z.object({
  wineId: EntityId,
  name: z.string(),
  vintage: z.number().int().optional(),
  wineType: WineType.optional(),
  grapes: z.array(z.string()).default([]),
  alcoholPercent: z.number().optional(),
  wineryName: z.string().optional(),
  regionPath: z.array(z.string()).default([]),
  country: z.string().optional(),
  labelTags: z.array(LabelTag).default([]),
  bottleShape: BottleShape.optional(),
  closure: Closure.optional(),
  tastingCount: z.number().int().min(0),
  lowConfidenceFields: z.array(z.string()).default([]),
});
export type WineDetail = z.infer<typeof WineDetail>;

export const FindWinesInput = z.object({
  name: z.string().max(200).optional(),
  winery: z.string().max(200).optional(),
  region: z.string().max(200).optional(),
  grape: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(20).default(20),
});
export type FindWinesInput = z.infer<typeof FindWinesInput>;

export const WineSummary = z.object({
  wineId: EntityId,
  name: z.string(),
  vintage: z.number().int().optional(),
  wineryName: z.string().optional(),
  regionPath: z.array(z.string()).default([]),
  grapes: z.array(z.string()).default([]),
  tastingCount: z.number().int().min(0),
});
export type WineSummary = z.infer<typeof WineSummary>;

export const FindWinesResult = z.object({
  wines: z.array(WineSummary).max(20),
});
export type FindWinesResult = z.infer<typeof FindWinesResult>;

/* ── 시음 조회 ─────────────────────────────────────────────────── */

export const GetTastingsForWineInput = z.object({ wineId: EntityId });
export type GetTastingsForWineInput = z.infer<typeof GetTastingsForWineInput>;

export const GetRecentTastingsInput = z.object({
  limit: z.number().int().min(1).max(20).default(10),
});
export type GetRecentTastingsInput = z.infer<typeof GetRecentTastingsInput>;

export const FindSimilarTastingsInput = z.object({
  grape: z.string().max(60).optional(),
  regionId: EntityId.optional(),
  axes: TastingNotes.partial().optional(),
  limit: z.number().int().min(1).max(10).default(5),
});
export type FindSimilarTastingsInput = z.infer<typeof FindSimilarTastingsInput>;

export const SimilarTasting = TastingSummary.extend({
  /** 유사 근거 */
  similarityBasis: z.array(z.string()).default([]),
  similarityScore: z.number().min(0).max(1),
});
export type SimilarTasting = z.infer<typeof SimilarTasting>;

export const TastingSummaryList = z.object({
  tastings: z.array(TastingSummary),
});
export type TastingSummaryList = z.infer<typeof TastingSummaryList>;

/* ── 프로파일 / 발견 조회 ──────────────────────────────────────── */

export const GetTasteProfileResult = z.object({
  active: z.boolean(),
  tastingCount: z.number().int().min(0),
  progress: z.number().min(0).max(1),
  narrative: z.string().optional(),
  liked: z
    .array(z.object({ dimension: z.string(), key: z.string(), n: z.number().int() }))
    .default([]),
  disliked: z
    .array(z.object({ dimension: z.string(), key: z.string(), n: z.number().int() }))
    .default([]),
  keywords: z.array(z.string()).default([]),
});
export type GetTasteProfileResult = z.infer<typeof GetTasteProfileResult>;

export const ListDiscoveriesInput = z.object({
  includeHidden: z.boolean().default(false),
});
export type ListDiscoveriesInput = z.infer<typeof ListDiscoveriesInput>;

export const ListDiscoveriesResult = z.object({
  discoveries: z.array(
    z.object({
      id: EntityId,
      groupBy: z.string(),
      key: z.string(),
      alias: z.string(),
      grade: DiscoveryGrade,
      n: z.number().int(),
      deltaVsOverall: z.number(),
      hidden: z.boolean(),
    }),
  ),
});
export type ListDiscoveriesResult = z.infer<typeof ListDiscoveriesResult>;

/* ── 웹 검색 (라벨 보강) ───────────────────────────────────────── */

export const WebSearchInput = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(5).default(3),
});
export type WebSearchInput = z.infer<typeof WebSearchInput>;

export const WebSearchResult = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      snippet: z.string(),
      url: z.url(),
    }),
  ),
});
export type WebSearchResult = z.infer<typeof WebSearchResult>;

/* ── 라벨 인식 출력 (R3) ───────────────────────────────────────── */

const withConfidence = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ value: schema, confidence: FieldConfidence });

export const LabelExtraction = z.object({
  name: withConfidence(z.string().min(1).max(200)).optional(),
  vintage: withConfidence(z.number().int().min(1900).max(2100)).optional(),
  wineryName: withConfidence(z.string().min(1).max(160)).optional(),
  country: withConfidence(z.string().min(1).max(60)).optional(),
  regionName: withConfidence(z.string().min(1).max(120)).optional(),
  grapes: withConfidence(z.array(z.string().min(1).max(60)).max(12)).optional(),
  alcoholPercent: withConfidence(z.number().min(0).max(30)).optional(),
  wineType: withConfidence(WineType).optional(),
  /** R8 탐색 축의 원천 데이터 */
  labelTags: withConfidence(z.array(LabelTag).max(8)).optional(),
  /**
   * 라벨에서 본 것을 열린 어휘로 적은 태그 (예: "범죄자 초상", "새", "빈티지 판화").
   * 고정 enum 으로는 담을 수 없는 세부를 R8 탐색 축으로 남기기 위한 필드다.
   */
  visualTags: withConfidence(z.array(z.string().min(1).max(40)).max(15)).optional(),
  /** 보강 단계에서 얻은 특징 태그 (예: "과실향 강함", "대중적", "호주 시라즈") */
  characterTags: withConfidence(z.array(z.string().min(1).max(40)).max(15)).optional(),
  /** 한 줄 특징 */
  characterNote: withConfidence(z.string().max(500)).optional(),
  bottleShape: withConfidence(BottleShape).optional(),
  closure: withConfidence(Closure).optional(),
  sourceUrls: z.array(z.url()).max(10).default([]),
  /** 인식 자체가 실패한 경우 */
  recognized: z.boolean(),
  failureReason: z.string().max(500).optional(),
});
export type LabelExtraction = z.infer<typeof LabelExtraction>;

/* ── 에이전트 런타임 계약 ─────────────────────────────────────── */

/** AgentCore `/invocations` 요청 본문 */
export const AgentInvocation = z.discriminatedUnion('task', [
  z.object({
    task: z.literal('analyze_upload'),
    tastingId: EntityId,
    recordingId: EntityId,
    audioKey: z.string().min(1),
  }),
  z.object({
    task: z.literal('analyze_transcribed'),
    tastingId: EntityId,
    recordingId: EntityId.optional(),
    transcribeJobName: z.string().optional(),
    transcriptKey: z.string().optional(),
    transcribeStatus: z.enum(['COMPLETED', 'FAILED']).default('COMPLETED'),
  }),
  z.object({
    task: z.literal('analyze_label'),
    imageKey: z.string().min(1),
    hint: z.string().max(500).optional(),
  }),
]);
export type AgentInvocation = z.infer<typeof AgentInvocation>;

export const AgentInvocationResult = z.object({
  ok: z.boolean(),
  task: z.string(),
  tastingId: EntityId.optional(),
  completedSteps: z.array(z.string()).default([]),
  skippedSteps: z.array(z.string()).default([]),
  label: LabelExtraction.optional(),
  error: z.string().optional(),
  traceId: z.string().optional(),
});
export type AgentInvocationResult = z.infer<typeof AgentInvocationResult>;

/** 세션 ID 최소 길이 (AgentCore 제약) */
export const MIN_RUNTIME_SESSION_ID_LENGTH = 33;
