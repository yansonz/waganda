import { z } from 'zod';
import { EntityId, IsoDateTime, PriceBand, Rating, entityMetaShape } from './common';

/** 기록 수집부터 공개 가능한 분석 완료까지의 시음 수명주기 */
export const TastingLifecycle = z.enum([
  'collecting',
  'awaiting_wine',
  'awaiting_audio',
  'reaction_ready',
  'polishing',
  'ready',
  'failed',
]);
export type TastingLifecycle = z.infer<typeof TastingLifecycle>;

/**
 * 시음 세션. 시음자 정보는 저장하지 않는다 (R2) — 화자는 음성에서 추정한다.
 * 와인은 사진·수동 연결로 나중에 붙을 수 있으므로 캡처 시작 시에는 비어 있을 수 있다.
 */
export const Tasting = z.object({
  id: EntityId,
  type: z.literal('TASTING'),
  wineId: EntityId.optional(),
  lifecycle: TastingLifecycle.optional(),
  tastedAt: IsoDateTime,
  labelImageKey: z.string().min(1).max(512).optional(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional(),
  /** priceKrw 로부터 파생 (R8 탐색 축) */
  priceBand: PriceBand.optional(),
  /** 편집자가 직접 넣은 평점 (AI 평점과 별도 보관) */
  manualRating: Rating.optional(),
  memo: z.string().max(2000).optional(),
  /** 곁들인 음식 사진 S3 키 목록 */
  foodImageKeys: z.array(z.string().min(1).max(512)).max(8).optional(),
  ...entityMetaShape,
});
export type Tasting = z.infer<typeof Tasting>;

export const TastingInput = z.object({
  wineId: EntityId.optional(),
  tastedAt: IsoDateTime,
  labelImageKey: z.string().min(1).max(512).optional(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional(),
  manualRating: Rating.optional(),
  memo: z.string().max(2000).optional(),
  /** 곁들인 음식 사진 S3 키 목록 */
  foodImageKeys: z.array(z.string().min(1).max(512)).max(8).optional(),
});
export type TastingInput = z.infer<typeof TastingInput>;

/** POST /api/tastings/[id]/wine — 기존 캡처에 와인·라벨 사진을 연결한다 */
export const TastingWineAttachmentInput = z.object({
  wineId: EntityId,
  labelImageKey: z.string().min(1).max(512).optional(),
});
export type TastingWineAttachmentInput = z.infer<typeof TastingWineAttachmentInput>;

/** PATCH /api/tastings/[id] — 수동 평점·요약·하이라이트 수정 (원본은 보존) */
export const TastingPatch = z.object({
  tastedAt: IsoDateTime.optional(),
  priceKrw: z.number().int().min(0).max(100_000_000).optional(),
  manualRating: Rating.optional(),
  memo: z.string().max(2000).optional(),
  editedSummary: z.string().max(4000).optional(),
  editedHighlights: z
    .array(
      z.object({
        quote: z.string().max(1000),
        note: z.string().max(1000),
        atSec: z.number().min(0).optional(),
      }),
    )
    .max(20)
    .optional(),
  /** 낙관적 동시성 — 클라이언트가 읽은 리비전 */
  rev: z.number().int().min(0).optional(),
});
export type TastingPatch = z.infer<typeof TastingPatch>;

/** 목록·통계용 시음 요약 (에이전트 도구 출력에도 사용) */
export const TastingSummary = z.object({
  tastingId: EntityId,
  wineId: EntityId,
  wineName: z.string(),
  vintage: z.number().int().optional(),
  tastedAt: IsoDateTime,
  rating: z.number().min(1).max(5).optional(),
  ratingSource: z.enum(['manual', 'ai']).optional(),
  summary: z.string().optional(),
});
export type TastingSummary = z.infer<typeof TastingSummary>;
