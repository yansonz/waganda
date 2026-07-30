import { z } from 'zod';

/**
 * 모든 레코드의 현재 스키마 버전.
 * 필드 구조를 바꿀 때마다 올리고 `lib/db/upcast.ts` 에 승격 규칙을 추가한다.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** 관계형 DB 없이 쓰는 구조이므로 버전을 레코드에 직접 박아 둔다. */
export const schemaVersionField = z.number().int().min(1);

/** ISO 8601 문자열 (UTC 권장) */
export const IsoDateTime = z.iso.datetime({ offset: true }).or(z.iso.datetime());

/** 엔티티 식별자 — 짧은 URL 안전 문자열 */
export const EntityId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'id 는 URL 안전 문자(A-Z a-z 0-9 _ -)만 허용한다');

/** 1~5, 0.5 단위 평점 */
export const Rating = z
  .number()
  .min(1)
  .max(5)
  .refine((v) => Math.round(v * 2) === v * 2, {
    message: '평점은 0.5 단위여야 한다',
  });

/** 5축 시음 노트의 각 축 (1~5 정수 또는 0.5 단위) */
export const NoteAxisValue = z
  .number()
  .min(1)
  .max(5)
  .refine((v) => Math.round(v * 2) === v * 2, {
    message: '노트 값은 0.5 단위여야 한다',
  });

/** 낙관적 동시성 제어용 리비전 */
export const RevField = z.number().int().min(0);

/** 모든 저장 엔티티가 공유하는 메타 필드 */
export const entityMetaShape = {
  schemaVersion: schemaVersionField,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  rev: RevField,
};

/** 화자 페르소나 — 부부 2인 고정 */
export const Persona = z.enum(['yan', 'robert']);
export type Persona = z.infer<typeof Persona>;

/** 화자 매핑 신뢰도 */
export const MappingConfidence = z.enum(['high', 'medium', 'none']);
export type MappingConfidence = z.infer<typeof MappingConfidence>;

/** 라벨 인식 필드 신뢰도 */
export const FieldConfidence = z.enum(['high', 'medium', 'low']);
export type FieldConfidence = z.infer<typeof FieldConfidence>;

/** 가격대 — R8 패턴 탐색 축 */
export const PriceBand = z.enum(['under_20k', '20k_50k', '50k_100k', '100k_200k', 'over_200k']);
export type PriceBand = z.infer<typeof PriceBand>;

/** 라벨 시각 태그 — R8 비전통 탐색 축의 원천 */
export const LabelTag = z.enum([
  'animal',
  'plant',
  'person',
  'minimal',
  'ornate',
  'calligraphy',
  'warm_tone',
  'cool_tone',
]);
export type LabelTag = z.infer<typeof LabelTag>;

/** 병 형태 */
export const BottleShape = z.enum(['bordeaux', 'burgundy', 'alsace', 'champagne', 'other']);
export type BottleShape = z.infer<typeof BottleShape>;

/** 마감 방식 */
export const Closure = z.enum(['cork', 'screwcap', 'crown', 'other']);
export type Closure = z.infer<typeof Closure>;

/** 와인 색/유형 */
export const WineType = z.enum(['red', 'white', 'rose', 'sparkling', 'dessert', 'fortified']);
export type WineType = z.infer<typeof WineType>;

/** 오디오 형식 (R2 허용 목록) */
export const AudioFormat = z.enum(['mp3', 'm4a', 'wav', 'webm']);
export type AudioFormat = z.infer<typeof AudioFormat>;

/** 가격(원)에서 가격대 산출 — 저장 시 함께 채운다 */
export function toPriceBand(priceKrw: number | undefined | null): PriceBand | undefined {
  if (priceKrw == null || Number.isNaN(priceKrw)) return undefined;
  if (priceKrw < 20_000) return 'under_20k';
  if (priceKrw < 50_000) return '20k_50k';
  if (priceKrw < 100_000) return '50k_100k';
  if (priceKrw < 200_000) return '100k_200k';
  return 'over_200k';
}
