/**
 * lib/domain/profile.ts — 취향 프로파일 (R7)
 *
 * 부부 공통 취향 프로파일 하나만 유지한다. 통계 계산은 자연어 추론이 아닌
 * 실행 가능한 계산 도구(이 파일의 순수 함수)로 수행한다.
 */
import {
  NoteAxis,
  PROFILE_MIN_TASTINGS,
  PROFILE_REFERENCE_SAMPLE_THRESHOLD,
  type FitLevel,
  type ProfileAttribute,
  type TasteProfile,
} from '@waganda/schemas';
import type { StatsInputTasting } from './types.js';

/** buildTasteProfile 이 참조하는 속성 축 — 품종·국가/지역·가격대 */
type AttributeDimension = 'grape' | 'country' | 'region' | 'priceBand';

const ATTRIBUTE_DIMENSIONS: AttributeDimension[] = ['grape', 'country', 'region', 'priceBand'];

/** 평점을 얻는다 — 수동 평점 우선, 없으면 AI 평점 */
function ratingOf(t: StatsInputTasting): number | undefined {
  return t.manualRating ?? t.aiRating;
}

/** 시음에서 특정 속성 축의 키 목록을 뽑는다 (다중값 축은 여러 키 반환) */
function keysForDimension(t: StatsInputTasting, dimension: AttributeDimension): string[] {
  switch (dimension) {
    case 'grape':
      return t.grapes;
    case 'country':
      return t.country ? [t.country] : [];
    case 'region': {
      const key = t.regionName ?? t.regionId;
      return key ? [key] : [];
    }
    case 'priceBand':
      return t.priceBand ? [t.priceBand] : [];
    default:
      return [];
  }
}

/** 평점 조건(4점 이상 또는 2점 이하)에 맞는 시음들로부터 속성별 표본을 집계한다 */
function collectAttributes(
  tastings: StatsInputTasting[],
  predicate: (rating: number) => boolean,
): ProfileAttribute[] {
  const buckets = new Map<string, { dimension: string; key: string; ratings: number[] }>();

  for (const t of tastings) {
    const rating = ratingOf(t);
    if (rating === undefined || !predicate(rating)) continue;

    for (const dimension of ATTRIBUTE_DIMENSIONS) {
      for (const key of keysForDimension(t, dimension)) {
        const bucketKey = `${dimension}:${key}`;
        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, { dimension, key, ratings: [] });
        }
        buckets.get(bucketKey)!.ratings.push(rating);
      }
    }
  }

  const attributes: ProfileAttribute[] = [];
  for (const { dimension, key, ratings } of buckets.values()) {
    const meanRating = ratings.reduce((acc, r) => acc + r, 0) / ratings.length;
    attributes.push({
      dimension,
      key,
      n: ratings.length,
      meanRating,
      grade: ratings.length < PROFILE_REFERENCE_SAMPLE_THRESHOLD ? 'reference' : 'solid',
    });
  }

  // 표본 수 내림차순, 동률이면 key 오름차순 — 결정론적 정렬
  attributes.sort((a, b) => (b.n !== a.n ? b.n - a.n : a.key.localeCompare(b.key)));
  return attributes;
}

/** 5축 평균을 계산한다. 노트가 없는 시음은 해당 축 계산에서 제외한다 */
function computeAxesAverage(tastings: StatsInputTasting[]): Partial<Record<NoteAxis, number>> {
  const axes = NoteAxis.options;
  const result: Partial<Record<NoteAxis, number>> = {};

  for (const axis of axes) {
    const values: number[] = [];
    for (const t of tastings) {
      const v = t.notes?.[axis];
      if (v !== undefined) values.push(v);
    }
    if (values.length > 0) {
      result[axis] = values.reduce((acc, v) => acc + v, 0) / values.length;
    }
  }

  return result;
}

/**
 * 누적 시음 기록으로부터 취향 프로파일을 계산한다.
 *
 * - 완료 시음 5건 미달 시 active:false, progress = n/5.
 * - 평점 4점 이상 공통 속성 → liked, 2점 이하 공통 속성 → disliked.
 * - 표본 3건 미만인 속성은 grade 'reference'.
 * - 5축 평균(axes)은 활성 여부와 무관하게 노트가 있는 시음이 있으면 산출한다.
 *
 * narrative, recommendations, shoppingGuide, agreementTrend 는 이 순수 함수의
 * 책임이 아니다(에이전트가 이 결과를 근거로 서술을 생성한다) — 빈 배열/undefined로 둔다.
 */
export function buildTasteProfile(tastings: StatsInputTasting[]): TasteProfile {
  const tastingCount = tastings.length;
  const active = tastingCount >= PROFILE_MIN_TASTINGS;
  const progress = Math.min(1, tastingCount / PROFILE_MIN_TASTINGS);

  const liked = active ? collectAttributes(tastings, (r) => r >= 4) : [];
  const disliked = active ? collectAttributes(tastings, (r) => r <= 2) : [];
  const axesRaw = computeAxesAverage(tastings);
  const axes = Object.keys(axesRaw).length > 0 ? axesRaw : undefined;

  return {
    type: 'PROFILE',
    active,
    tastingCount,
    progress,
    axes,
    liked,
    disliked,
    keywords: [],
    recommendations: [],
    agreementTrend: [],
    schemaVersion: 2,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    rev: 0,
  };
}

/**
 * 취향 프로파일을 재계산해야 하는 시점인지 판정한다 (R7).
 * 완료 시음 수가 5의 배수일 때만 true. 0건일 때는 재계산할 이유가 없으므로 false.
 */
export function shouldRefreshProfile(completedCount: number): boolean {
  if (completedCount <= 0) return false;
  return completedCount % PROFILE_MIN_TASTINGS === 0;
}

/** assessFit 이 참조하는 와인 속성의 최소 형태 */
export interface FitAssessmentWineInput {
  grapes?: string[];
  country?: string;
  regionName?: string;
  priceBand?: string;
}

/**
 * 취향 프로파일과 와인 속성을 비교해 적합도를 판정한다 (R7).
 *
 * - 프로파일이 비활성이면 'unknown'.
 * - 와인 속성이 disliked 속성과 겹치고 liked 와 겹치지 않으면 'dislike'.
 * - liked 와 disliked 양쪽에 걸치거나 어느 쪽에도 명확히 속하지 않으면 'challenging'.
 * - liked 속성과 뚜렷이 겹치고 disliked 와 겹치지 않으면 'perfect'.
 * - 겹치는 속성이 전혀 없으면 'unknown'.
 */
export function assessFit(profile: TasteProfile, wine: FitAssessmentWineInput): FitLevel {
  if (!profile.active) {
    return 'unknown';
  }

  const wineKeys = new Set<string>();
  for (const grape of wine.grapes ?? []) wineKeys.add(`grape:${grape}`);
  if (wine.country) wineKeys.add(`country:${wine.country}`);
  if (wine.regionName) wineKeys.add(`region:${wine.regionName}`);
  if (wine.priceBand) wineKeys.add(`priceBand:${wine.priceBand}`);

  const likedKeys = new Set(profile.liked.map((a) => `${a.dimension}:${a.key}`));
  const dislikedKeys = new Set(profile.disliked.map((a) => `${a.dimension}:${a.key}`));

  let likedHit = false;
  let dislikedHit = false;
  for (const key of wineKeys) {
    if (likedKeys.has(key)) likedHit = true;
    if (dislikedKeys.has(key)) dislikedHit = true;
  }

  if (!likedHit && !dislikedHit) return 'unknown';
  if (dislikedHit && !likedHit) return 'dislike';
  if (likedHit && !dislikedHit) return 'perfect';
  return 'challenging';
}
