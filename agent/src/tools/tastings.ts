/**
 * tools/tastings.ts — 시음 조회 + 프로파일/발견 조회 도구. 전부 읽기 전용.
 */
import type { Repository } from '@app/db/repository';
import type {
  FindSimilarTastingsInput,
  GetRecentTastingsInput,
  GetTasteProfileResult,
  GetTastingsForWineInput,
  ListDiscoveriesInput,
  ListDiscoveriesResult,
  SimilarTasting,
  TastingSummaryList,
} from '@waganda/schemas';

export interface TastingsContext {
  repo: Repository;
}

interface RawTastingRecord {
  id: string;
  type: string;
  wineId: string;
  tastedAt: string;
  manualRating?: number;
}

interface RawAnalysisRecord {
  type: string;
  tastingId: string;
  aiRating?: number;
  summary?: string;
  notes?: Record<string, number>;
}

interface RawWineRecord {
  id: string;
  type: string;
  name: string;
  vintage?: number;
  grapes: string[];
  regionId?: string;
}

async function loadAll(repo: Repository) {
  const { items } = await repo.scanAll<Record<string, unknown>>();
  const tastings = items.filter((i) => i['type'] === 'TASTING') as unknown as RawTastingRecord[];
  const analyses = items.filter((i) => i['type'] === 'ANALYSIS') as unknown as RawAnalysisRecord[];
  const wines = items.filter((i) => i['type'] === 'WINE') as unknown as RawWineRecord[];
  return { tastings, analyses, wines };
}

function toSummary(
  t: RawTastingRecord,
  wine: RawWineRecord | undefined,
  analysis: RawAnalysisRecord | undefined,
) {
  const rating = t.manualRating ?? analysis?.aiRating;
  const ratingSource: 'manual' | 'ai' | undefined =
    t.manualRating !== undefined ? 'manual' : analysis?.aiRating !== undefined ? 'ai' : undefined;

  return {
    tastingId: t.id,
    wineId: t.wineId,
    wineName: wine?.name ?? '(알 수 없는 와인)',
    vintage: wine?.vintage,
    tastedAt: t.tastedAt,
    rating,
    ratingSource,
    summary: analysis?.summary,
  };
}

/** 특정 와인의 시음 이력을 시간순으로 반환한다 */
export async function getTastingsForWine(
  ctx: TastingsContext,
  input: GetTastingsForWineInput,
): Promise<TastingSummaryList> {
  const { tastings, analyses, wines } = await loadAll(ctx.repo);
  const wine = wines.find((w) => w.id === input.wineId);
  const analysisByTasting = new Map(analyses.map((a) => [a.tastingId, a]));

  const matched = tastings
    .filter((t) => t.wineId === input.wineId)
    .sort((a, b) => a.tastedAt.localeCompare(b.tastedAt))
    .map((t) => toSummary(t, wine, analysisByTasting.get(t.id)));

  return { tastings: matched };
}

/** 최신순 시음 목록 (최대 20건) */
export async function getRecentTastings(
  ctx: TastingsContext,
  input: GetRecentTastingsInput,
): Promise<TastingSummaryList> {
  const { tastings, analyses, wines } = await loadAll(ctx.repo);
  const analysisByTasting = new Map(analyses.map((a) => [a.tastingId, a]));
  const wineById = new Map(wines.map((w) => [w.id, w]));

  const sorted = [...tastings]
    .sort((a, b) => b.tastedAt.localeCompare(a.tastedAt))
    .slice(0, input.limit)
    .map((t) => toSummary(t, wineById.get(t.wineId), analysisByTasting.get(t.id)));

  return { tastings: sorted };
}

/** 품종·지역·5축 유사도 기준으로 유사 시음을 찾는다 (최대 10건) */
export async function findSimilarTastings(
  ctx: TastingsContext,
  input: FindSimilarTastingsInput,
): Promise<{ tastings: SimilarTasting[] }> {
  const { tastings, analyses, wines } = await loadAll(ctx.repo);
  const analysisByTasting = new Map(analyses.map((a) => [a.tastingId, a]));
  const wineById = new Map(wines.map((w) => [w.id, w]));

  const candidates: SimilarTasting[] = [];

  for (const t of tastings) {
    const wine = wineById.get(t.wineId);
    const analysis = analysisByTasting.get(t.id);
    const basis: string[] = [];
    let score = 0;

    if (input.grape && wine?.grapes.includes(input.grape)) {
      basis.push(`품종 일치: ${input.grape}`);
      score += 0.4;
    }
    if (input.regionId && wine?.regionId === input.regionId) {
      basis.push('지역 일치');
      score += 0.4;
    }
    if (input.axes && analysis?.notes) {
      const axisKeys = Object.keys(input.axes) as Array<keyof typeof input.axes>;
      let axisHits = 0;
      for (const key of axisKeys) {
        const target = input.axes[key];
        const actual = analysis.notes[key];
        if (target !== undefined && actual !== undefined && Math.abs(target - actual) <= 1) {
          axisHits += 1;
        }
      }
      if (axisHits > 0) {
        basis.push(`노트 유사(${axisHits}축)`);
        score += 0.2 * (axisHits / Math.max(axisKeys.length, 1));
      }
    }

    if (basis.length === 0) continue;

    candidates.push({
      ...toSummary(t, wine, analysis),
      similarityBasis: basis,
      similarityScore: Math.min(1, score),
    });
  }

  candidates.sort((a, b) => b.similarityScore - a.similarityScore);
  return { tastings: candidates.slice(0, input.limit) };
}

/** 취향 프로파일 조회 — 비활성 상태도 그대로 반환한다 */
export async function getTasteProfile(ctx: TastingsContext): Promise<GetTasteProfileResult> {
  const profile = await ctx.repo.getProfile();
  if (!profile) {
    return { active: false, tastingCount: 0, progress: 0, liked: [], disliked: [], keywords: [] };
  }

  return {
    active: profile.active,
    tastingCount: profile.tastingCount,
    progress: profile.progress,
    narrative: profile.narrative,
    liked: profile.liked.map((a) => ({ dimension: a.dimension, key: a.key, n: a.n })),
    disliked: profile.disliked.map((a) => ({ dimension: a.dimension, key: a.key, n: a.n })),
    keywords: profile.keywords,
  };
}

/** 발견 카드 목록 조회 — 기본적으로 숨긴 카드는 제외한다 */
export async function listDiscoveries(
  ctx: TastingsContext,
  input: ListDiscoveriesInput,
): Promise<ListDiscoveriesResult> {
  const { items } = await ctx.repo.listByType<{
    id: string;
    groupBy: string;
    key: string;
    alias: string;
    grade: 'weak' | 'moderate' | 'strong';
    n: number;
    deltaVsOverall: number;
    hidden: boolean;
  }>('DISCOVERY', 'desc');

  const filtered = input.includeHidden ? items : items.filter((d) => !d.hidden);

  return {
    discoveries: filtered.map((d) => ({
      id: d.id,
      groupBy: d.groupBy,
      key: d.key,
      alias: d.alias,
      grade: d.grade,
      n: d.n,
      deltaVsOverall: d.deltaVsOverall,
      hidden: d.hidden,
    })),
  };
}
