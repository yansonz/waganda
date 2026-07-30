import { z } from 'zod';
import {
  BottleShape,
  Closure,
  EntityId,
  FieldConfidence,
  LabelTag,
  WineType,
  entityMetaShape,
} from './common';

/**
 * 저신뢰 필드 표시 — 라벨 인식으로 채운 필드의 신뢰도를 필드명별로 보관한다.
 * UI 는 `low` 인 필드를 강조해 편집자가 확인하게 한다 (R3).
 */
export const FieldConfidenceMap = z.record(z.string(), FieldConfidence);
export type FieldConfidenceMap = z.infer<typeof FieldConfidenceMap>;

export const Wine = z.object({
  id: EntityId,
  type: z.literal('WINE'),
  /** R4: 이름만 필수 */
  name: z.string().min(1).max(200),
  nameNormalized: z.string().min(1),
  vintage: z.number().int().min(1900).max(2100).optional(),
  wineType: WineType.optional(),
  wineryId: EntityId.optional(),
  regionId: EntityId.optional(),
  /**
   * 와이너리·지역 이름의 자유 텍스트 폴백.
   *
   * 라벨 인식·웹 검색은 "19 Crimes", "South Australia" 같은 **이름**을 알아내지만
   * 카탈로그에 대응하는 엔티티가 없으면 `wineryId`/`regionId` 로 연결할 수 없다.
   * 이 값을 버리면 화면에 산지·와이너리가 아무것도 남지 않는다(실제로 그런 결함이 있었다).
   * 참조가 있으면 참조가 우선하고, 없을 때만 이 텍스트를 표시·검색에 쓴다.
   * 지역 계층 탐색은 `regionId` 기반이므로 이 값으로 계층을 만들지는 않는다.
   */
  wineryName: z.string().min(1).max(200).optional(),
  regionName: z.string().min(1).max(200).optional(),
  country: z.string().min(2).max(60).optional(),
  grapes: z.array(z.string().min(1).max(60)).max(12).default([]),
  alcoholPercent: z.number().min(0).max(30).optional(),
  /** 라벨 시각 태그 — R8 비전통 탐색 축 */
  labelTags: z.array(LabelTag).max(8).default([]),
  bottleShape: BottleShape.optional(),
  closure: Closure.optional(),
  notes: z.string().max(4000).optional(),
  /**
   * 자유 태그 — 라벨의 시각 모티프와 와인 특징을 열린 어휘로 남긴다.
   *
   * `labelTags`(고정 enum 8종)는 통계 축으로 쓰기 좋지만 표현력이 없다.
   * "범죄자 초상", "새 그림", "빈티지 판화", "과실향 강함" 같은 세부는 여기에 담는다.
   * 표기를 통일하지 않고 **있는 그대로** 쌓는다 — 인사이트는 나중에 LLM 이 전체를 훑어
   * 찾는다("평점 좋은 와인은 라벨에 새가 있더라"). 코드가 미리 뭉개면 원문이 사라진다.
   * 통계 축(`groupBy: 'tag'`)으로도 쓸 수 있지만 주 용도는 LLM 탐색이다.
   */
  tags: z.array(z.string().min(1).max(40)).max(30).default([]),
  /** 한 줄 특징 — 보강 단계에서 얻은 요약 (표시·모델 문맥용) */
  characterNote: z.string().max(500).optional(),
  /** 라벨 인식 출처 URL (webSearch 보강 시 기록) */
  sourceUrls: z.array(z.url()).max(10).default([]),
  fieldConfidence: FieldConfidenceMap.optional(),
  /**
   * 초안 와인 여부.
   *
   * 기록 흐름에서 라벨 사진 인식 결과로 **즉시** 생성한 와인이다.
   * 시음을 바로 붙일 수 있게 하려고 만들며(현실 순서: 사진 → 녹음 → 확인),
   * 편집자가 정보를 확인·수정하면 초안이 해제된다.
   * 카탈로그 목록에서는 숨겨 확정된 와인과 섞이지 않게 한다.
   */
  draft: z.boolean().default(false),
  ...entityMetaShape,
});
export type Wine = z.infer<typeof Wine>;

export const WineInput = z.object({
  name: z.string().min(1).max(200),
  vintage: z.number().int().min(1900).max(2100).optional(),
  wineType: WineType.optional(),
  wineryId: EntityId.optional(),
  regionId: EntityId.optional(),
  /** 참조를 만들 수 없을 때의 이름 폴백 (Wine 참고) */
  wineryName: z.string().min(1).max(200).optional(),
  regionName: z.string().min(1).max(200).optional(),
  country: z.string().min(2).max(60).optional(),
  grapes: z.array(z.string().min(1).max(60)).max(12).optional(),
  alcoholPercent: z.number().min(0).max(30).optional(),
  labelTags: z.array(LabelTag).max(8).optional(),
  bottleShape: BottleShape.optional(),
  closure: Closure.optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  characterNote: z.string().max(500).optional(),
  sourceUrls: z.array(z.url()).max(10).optional(),
  fieldConfidence: FieldConfidenceMap.optional(),
  /** 초안으로 생성할지 여부 (라벨 인식 직후 자동 생성 경로에서 true) */
  draft: z.boolean().optional(),
});
export type WineInput = z.infer<typeof WineInput>;

export const WinePatch = WineInput.partial();
export type WinePatch = z.infer<typeof WinePatch>;

/** 중복 후보 (이름+빈티지+와이너리 조합) */
export const DuplicateCandidate = z.object({
  wineId: EntityId,
  name: z.string(),
  vintage: z.number().int().optional(),
  wineryName: z.string().optional(),
  /** 일치 근거 */
  matchedOn: z.array(z.enum(['name', 'vintage', 'winery'])),
  tastingCount: z.number().int().min(0),
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidate>;
