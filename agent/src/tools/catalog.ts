/**
 * tools/catalog.ts — 카탈로그 조회 도구 (getWine, findWines). 전부 읽기 전용.
 *
 * `@app/db/repository`(Repository 인터페이스)를 통해서만 DynamoDB에 접근한다.
 * 여기서 직접 AWS SDK를 호출하지 않는다 — 결정론적 쓰기와의 경로 분리를 위해
 * 저장 계층은 항상 이 어댑터 뒤에 둔다.
 */
import type { Repository } from '@app/db/repository';
import { regionPath } from '@app/domain/region';
import type {
  FindWinesInput,
  FindWinesResult,
  GetWineInput,
  Region,
  WineDetail,
  WineSummary,
  Winery,
} from '@waganda/schemas';
import { matchWines, type SearchableWine } from '@app/domain/search';

/** getWine/findWines 가 공통으로 필요로 하는 조회 컨텍스트 */
export interface CatalogContext {
  repo: Repository;
}

async function loadRegionPath(repo: Repository, regionId: string | undefined): Promise<string[]> {
  if (!regionId) return [];
  const { items: regions } = await repo.scanAll<Region>();
  return regionPath(regions, regionId);
}

async function loadWinery(repo: Repository, wineryId: string | undefined): Promise<Winery | undefined> {
  if (!wineryId) return undefined;
  return repo.getWinery(wineryId);
}

/** wineId 로 와인 상세(와이너리·지역 경로 포함)를 조회한다. 존재하지 않으면 undefined */
export async function getWine(ctx: CatalogContext, input: GetWineInput): Promise<WineDetail | undefined> {
  const wine = await ctx.repo.getWine(input.wineId);
  if (!wine) return undefined;

  const [winery, path] = await Promise.all([
    loadWinery(ctx.repo, wine.wineryId),
    loadRegionPath(ctx.repo, wine.regionId),
  ]);

  const { items: tastings } = await ctx.repo.scanAll<{ type: string; wineId: string }>();
  const tastingCount = tastings.filter((t) => t.type === 'TASTING' && t.wineId === wine.id).length;

  const lowConfidenceFields = Object.entries(wine.fieldConfidence ?? {})
    .filter(([, confidence]) => confidence === 'low')
    .map(([field]) => field);

  return {
    wineId: wine.id,
    name: wine.name,
    vintage: wine.vintage,
    wineType: wine.wineType,
    grapes: wine.grapes,
    alcoholPercent: wine.alcoholPercent,
    wineryName: winery?.name,
    regionPath: path,
    country: wine.country,
    labelTags: wine.labelTags,
    bottleShape: wine.bottleShape,
    closure: wine.closure,
    tastingCount,
    lowConfidenceFields,
  };
}

/** name/winery/region/grape 부분일치로 와인을 찾는다. 최대 20건 */
export async function findWines(
  ctx: CatalogContext,
  input: FindWinesInput,
): Promise<FindWinesResult> {
  const { items: wines } = await ctx.repo.scanAll<{
    id: string;
    type: string;
    name: string;
    vintage?: number;
    wineryId?: string;
    regionId?: string;
    grapes: string[];
  }>();

  const wineRecords = wines.filter((w) => w.type === 'WINE');

  const wineryIds = new Set(wineRecords.map((w) => w.wineryId).filter((id): id is string => !!id));
  const wineries = new Map<string, Winery>();
  for (const id of wineryIds) {
    const winery = await ctx.repo.getWinery(id);
    if (winery) wineries.set(id, winery);
  }

  const { items: regions } = await ctx.repo.scanAll<Region>();
  const regionById = new Map(regions.map((r) => [r.id, r]));

  const searchable: SearchableWine[] = wineRecords.map((w) => ({
    wineId: w.id,
    name: w.name,
    wineryName: w.wineryId ? wineries.get(w.wineryId)?.name : undefined,
    regionName: w.regionId ? regionById.get(w.regionId)?.name : undefined,
    grapes: w.grapes,
  }));

  const query = [input.name, input.winery, input.region, input.grape]
    .filter((v): v is string => !!v)
    .join(' ');

  const matched = query.length > 0 ? matchWines(searchable, query) : [];
  const byId = new Map(wineRecords.map((w) => [w.id, w]));

  const summaries: WineSummary[] = [];
  for (const match of matched.slice(0, input.limit)) {
    const wine = byId.get(match.wineId);
    if (!wine) continue;
    const path = wine.regionId ? regionPath(regions, wine.regionId) : [];
    const { items: tastings } = await ctx.repo.scanAll<{ type: string; wineId: string }>();
    const tastingCount = tastings.filter((t) => t.type === 'TASTING' && t.wineId === wine.id).length;
    summaries.push({
      wineId: wine.id,
      name: wine.name,
      vintage: wine.vintage,
      wineryName: wine.wineryId ? wineries.get(wine.wineryId)?.name : undefined,
      regionPath: path,
      grapes: wine.grapes,
      tastingCount,
    });
  }

  return { wines: summaries };
}
