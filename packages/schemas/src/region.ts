import { z } from 'zod';
import { EntityId, entityMetaShape } from './common';

/** 지역 계층 단계 — 국가 > 광역 > 세부 산지 */
export const RegionLevel = z.enum(['country', 'region', 'subregion']);
export type RegionLevel = z.infer<typeof RegionLevel>;

/** 저장되는 지역 레코드 */
export const Region = z.object({
  id: EntityId,
  type: z.literal('REGION'),
  name: z.string().min(1).max(120),
  /** 정규화된 이름 (검색·GSI 정렬용) */
  nameNormalized: z.string().min(1),
  level: RegionLevel,
  /** 상위 지역. `country` 레벨에는 없다 */
  parentId: EntityId.optional(),
  /** 국가명 또는 ISO 3166-1 alpha-2 코드 */
  country: z.string().min(2).max(60).optional(),
  ...entityMetaShape,
});
export type Region = z.infer<typeof Region>;

/** 클라이언트가 보내는 지역 생성 입력 */
export const RegionInput = z.object({
  name: z.string().min(1).max(120),
  level: RegionLevel,
  parentId: EntityId.optional(),
  country: z.string().min(2).max(60).optional(),
});
export type RegionInput = z.infer<typeof RegionInput>;

/** 부분 수정 입력 */
export const RegionPatch = RegionInput.partial();
export type RegionPatch = z.infer<typeof RegionPatch>;

/** 계층 트리 노드 (메모리 연산 결과, 저장하지 않음) */
export interface RegionTreeNode {
  id: string;
  name: string;
  level: RegionLevel;
  country?: string;
  path: string[];
  children: RegionTreeNode[];
}
