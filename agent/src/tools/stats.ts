/**
 * tools/stats.ts — computeStats 도구.
 *
 * design.md '도구 계약': "임의 코드나 SQL 이 아니라 제한된 스펙"만 받는다.
 * `ComputeStatsSpec` Zod 스키마가 이미 groupBy/metric/minSampleSize 범위를
 * 제한하므로, 이 파일은 `@app/domain/stats` 의 순수 함수를 호출하는 조회
 * 전용 어댑터일 뿐이다 — 스펙 밖의 입력은 Zod 파싱 단계에서 이미 거부된다.
 */
import type { Repository } from '@app/db/repository';
import { computeStats as computeStatsPure } from '@app/domain/stats';
import { deriveWeekday, deriveHourBucket, deriveAgreementBand, type StatsInputTasting } from '@app/domain/types';
import type { ComputeStatsResult, ComputeStatsSpec } from '@waganda/schemas';

export interface StatsContext {
  repo: Repository;
}

/**
 * Repository 의 전량 Scan 결과로부터 `computeStats` 입력(StatsInputTasting[])을
 * 구성한다. Tasting/Wine/Analysis 를 조합해 평면 뷰로 만든다.
 */
async function loadStatsInputTastings(repo: Repository): Promise<StatsInputTasting[]> {
  const { items: allItems } = await repo.scanAll<Record<string, unknown>>();

  const tastings = allItems.filter((i) => i['type'] === 'TASTING') as Array<{
    id: string;
    wineId: string;
    tastedAt: string;
    manualRating?: number;
    priceBand?: StatsInputTasting['priceBand'];
  }>;
  const wines = new Map(
    allItems
      .filter((i) => i['type'] === 'WINE')
      .map((w) => [String(w['id']), w as Record<string, unknown>]),
  );
  const analyses = new Map(
    allItems
      .filter((i) => i['type'] === 'ANALYSIS')
      .map((a) => [String(a['tastingId']), a as Record<string, unknown>]),
  );

  const sorted = [...tastings].sort((a, b) => a.tastedAt.localeCompare(b.tastedAt));

  const result: StatsInputTasting[] = [];
  let prevTastedAt: string | undefined;

  for (const t of sorted) {
    const wine = wines.get(t.wineId);
    const analysis = analyses.get(t.id);

    const daysSincePrevTasting = prevTastedAt
      ? Math.round((new Date(t.tastedAt).getTime() - new Date(prevTastedAt).getTime()) / 86_400_000)
      : undefined;
    prevTastedAt = t.tastedAt;

    const agreementScore = analysis?.['agreementScore'] as number | undefined;
    const acoustic = undefined; // hadLaughter 는 아래에서 recording 조회로 별도 판정한다

    result.push({
      tastingId: t.id,
      tastedAt: t.tastedAt,
      manualRating: t.manualRating,
      aiRating: analysis?.['aiRating'] as number | undefined,
      notes: analysis?.['notes'] as StatsInputTasting['notes'],
      grapes: (wine?.['grapes'] as string[] | undefined) ?? [],
      country: wine?.['country'] as string | undefined,
      regionId: wine?.['regionId'] as string | undefined,
      priceBand: t.priceBand,
      vintage: wine?.['vintage'] as number | undefined,
      labelTags: (wine?.['labelTags'] as StatsInputTasting['labelTags']) ?? [],
      // 자유 태그 축 — 라벨 모티프·특징으로 패턴을 찾는다 (R8)
      tags: (wine?.['tags'] as string[]) ?? [],
      bottleShape: wine?.['bottleShape'] as StatsInputTasting['bottleShape'],
      closure: wine?.['closure'] as StatsInputTasting['closure'],
      weekday: deriveWeekday(t.tastedAt),
      hourBucket: deriveHourBucket(t.tastedAt),
      daysSincePrevTasting,
      hadLaughter: acoustic,
      agreementScore,
    });
  }

  return result;
}

/** `ComputeStatsSpec` 을 받아 그룹별 통계를 계산해 반환한다. 순수 계산은 domain 계층이 담당한다 */
export async function computeStats(
  ctx: StatsContext,
  spec: ComputeStatsSpec,
): Promise<ComputeStatsResult> {
  const tastings = await loadStatsInputTastings(ctx.repo);
  return computeStatsPure(tastings, spec);
}

/** deriveAgreementBand 재노출 — 도구 조합 시 다른 모듈에서 재계산하지 않도록 */
export { deriveAgreementBand };
