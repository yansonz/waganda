/**
 * lib/views/read.ts — 서버 컴포넌트용 공개 읽기 뷰 헬퍼 (14.1~14.6, 12.4~12.6, 13.6).
 *
 * `lib/db/repository.ts`(Repository 인터페이스)와 `lib/domain/**`(순수 계산)을 조합해
 * 각 공개 화면이 그대로 렌더링할 수 있는 형태의 뷰 데이터를 만든다.
 *
 * 설계 원칙:
 * - 모든 함수는 `Repository`를 첫 인자로 주입받는다 — 테스트에서 인메모리 구현으로 교체하기 쉽다.
 * - 여기서는 캐시 무효화·쓰기를 하지 않는다(순수 조회). 쓰기는 `lib/services/**`의 책임이다.
 * - 데이터가 전혀 없는 상태(레코드 0건)에서도 예외를 던지지 않고 빈 값/빈 배열을 반환한다.
 */
import type {
  Analysis,
  Discovery,
  Job,
  Recording,
  Region,
  Tasting,
  TasteProfile,
  Wine,
  Winery,
} from '@waganda/schemas';
import type { Repository } from '@/lib/db/repository';
import { buildRegionTree, regionPath } from '@/lib/domain/region';
import { assessFit, type FitAssessmentWineInput } from '@/lib/domain/profile';
import { aggregateByMonth, type AgreementEntry } from '@/lib/domain/agreement';
import { matchWines, type SearchableWine } from '@/lib/domain/search';
import type { FitLevel } from '@waganda/schemas';
import type { RegionTreeNode } from '@waganda/schemas';

/* ── 공통 조합 헬퍼 ────────────────────────────────────────────── */

/**
 * S3 키를 공개 CDN 경로로 변환한다 (infrastructure/lib/web-stack.ts `/media/*` 캐시 정책).
 * 컴포넌트가 오디오/이미지 원본 버킷을 직접 참조하지 않고 이 헬퍼를 통해 CDN 경로만 사용한다.
 */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/** 와인 목록과 와이너리/지역 목록을 한 번에 모아 표시용 맵으로 만든다 */
async function loadCatalog(repo: Repository): Promise<{
  wines: Wine[];
  wineries: Winery[];
  regions: Region[];
  wineryById: Map<string, Winery>;
  regionById: Map<string, Region>;
}> {
  const [{ items: wines }, { items: wineries }, { items: regions }] = await Promise.all([
    repo.listByType<Wine>('WINE', 'asc'),
    repo.listByType<Winery>('WINERY', 'asc'),
    repo.listByType<Region>('REGION', 'asc'),
  ]);
  return {
    wines,
    wineries,
    regions,
    wineryById: new Map(wineries.map((w) => [w.id, w])),
    regionById: new Map(regions.map((r) => [r.id, r])),
  };
}

/** 지역 ID로 표시용 이름(세부 산지 이름)을 조회한다 */
function regionDisplayName(regionById: Map<string, Region>, regionId?: string): string | undefined {
  if (!regionId) return undefined;
  return regionById.get(regionId)?.name;
}

/** 미연결·분석 중 캡처는 공개 목록·RSS·통계에 포함하지 않는다. */
function isPublishedTasting(tasting: Tasting): tasting is Tasting & { wineId: string } {
  return tasting.wineId !== undefined && (tasting.lifecycle ?? 'ready') === 'ready';
}

/* ── 와인 요약 뷰 (여러 화면이 공유) ──────────────────────────── */

export interface WineSummaryView {
  wineId: string;
  name: string;
  vintage?: number;
  wineryName?: string;
  regionName?: string;
  country?: string;
  grapes: string[];
  labelImageKey?: string;
}

/**
 * 목록·카드용 와인 요약.
 *
 * 와이너리·지역은 카탈로그 참조가 있으면 그 이름을, 없으면 라벨 인식·검색으로 얻은
 * 자유 텍스트(`wine.wineryName`/`wine.regionName`)를 쓴다.
 * 참조가 없는 와인(라벨 인식 초안 등)에서 산지가 통째로 비어 보이던 문제를 막는다.
 */
function toWineSummary(
  wine: Wine,
  wineryById: Map<string, Winery>,
  regionById: Map<string, Region>,
): WineSummaryView {
  return {
    wineId: wine.id,
    name: wine.name,
    vintage: wine.vintage,
    wineryName:
      (wine.wineryId ? wineryById.get(wine.wineryId)?.name : undefined) ?? wine.wineryName,
    regionName: regionDisplayName(regionById, wine.regionId) ?? wine.regionName,
    country: wine.country,
    grapes: wine.grapes,
  };
}

/* ── 시음 요약 뷰 (대시보드·타임라인·와인 상세 공유) ─────────── */

export interface TastingSummaryView {
  tastingId: string;
  wineId: string;
  wineName: string;
  vintage?: number;
  tastedAt: string;
  aiRating?: number;
  manualRating?: number;
  /** 화면에 표시할 대표 평점 — 수동 우선 */
  displayRating?: number;
  ratingSource?: 'manual' | 'ai';
  summary?: string;
  labelImageKey?: string;
  agreementScore?: number;
}

function toTastingSummary(
  tasting: Tasting & { wineId: string },
  wine: Wine | undefined,
  analysis: Analysis | undefined,
): TastingSummaryView {
  const displayRating = tasting.manualRating ?? analysis?.aiRating;
  const ratingSource: 'manual' | 'ai' | undefined =
    tasting.manualRating !== undefined
      ? 'manual'
      : analysis?.aiRating !== undefined
        ? 'ai'
        : undefined;

  return {
    tastingId: tasting.id,
    wineId: tasting.wineId,
    wineName: wine?.name ?? '(알 수 없는 와인)',
    vintage: wine?.vintage,
    tastedAt: tasting.tastedAt,
    aiRating: analysis?.aiRating,
    manualRating: tasting.manualRating,
    displayRating,
    ratingSource,
    summary: analysis?.editedSummary ?? analysis?.summary,
    labelImageKey: tasting.labelImageKey,
    agreementScore: analysis?.agreementScore,
  };
}

/** 전체 시음+와인+분석을 한 번에 모아 시음 요약 목록으로 만든다 (최신순) */
async function loadAllTastingSummaries(repo: Repository): Promise<{
  summaries: TastingSummaryView[];
  tastings: Tasting[];
  wineById: Map<string, Wine>;
}> {
  const [{ items: tastings }, { wines }] = await Promise.all([
    repo.listByType<Tasting>('TASTING', 'desc'),
    loadCatalog(repo),
  ]);
  const wineById = new Map(wines.map((w) => [w.id, w]));
  const publishedTastings = tastings.filter(isPublishedTasting);

  const summaries: TastingSummaryView[] = [];
  for (const tasting of publishedTastings) {
    const analysis = await repo.getAnalysis(tasting.id);
    summaries.push(toTastingSummary(tasting, wineById.get(tasting.wineId), analysis));
  }

  return { summaries, tastings: publishedTastings, wineById };
}

/* ── 14.1 대시보드 ────────────────────────────────────────────── */

export interface DashboardView {
  recentTastings: TastingSummaryView[];
  tasteProfile: TasteProfileView;
  recentAgreementScores: { tastingId: string; tastedAt: string; score: number }[];
  latestDiscoveries: DiscoveryView[];
  inProgressJobs: InProgressJobView[];
}

export interface InProgressJobView {
  tastingId: string;
  wineName: string;
  status: Job['status'];
  estimatedSec?: number;
}

const DASHBOARD_RECENT_TASTINGS_LIMIT = 5;
const DASHBOARD_RECENT_AGREEMENT_LIMIT = 5;
const DASHBOARD_DISCOVERY_LIMIT = 3;

/** 대시보드 뷰 데이터 조합 (14.1 — 최신 시음, 취향 카드, 최근 반응 일치도, 새 발견 카드, 진행 중 분석) */
export async function getDashboardView(repo: Repository): Promise<DashboardView> {
  const { summaries } = await loadAllTastingSummaries(repo);

  const recentTastings = summaries.slice(0, DASHBOARD_RECENT_TASTINGS_LIMIT);

  const recentAgreementScores = summaries
    .filter((s) => s.agreementScore !== undefined)
    .slice(0, DASHBOARD_RECENT_AGREEMENT_LIMIT)
    .map((s) => ({ tastingId: s.tastingId, tastedAt: s.tastedAt, score: s.agreementScore! }));

  const [tasteProfile, { items: discoveries }] = await Promise.all([
    getTasteProfileView(repo),
    repo.listByType<Discovery>('DISCOVERY', 'desc'),
  ]);

  const latestDiscoveries = discoveries
    .filter((d) => !d.hidden)
    .slice(0, DASHBOARD_DISCOVERY_LIMIT)
    .map(toDiscoveryView);

  // Job 은 시음 세션 파티션(pk = TASTING#<id>)에 속해 GSI1 TYPE 목록에 나타나지 않으므로,
  // 진행 중인 작업은 전체 시음을 순회해 job 상태를 개별 조회한다.
  const inProgressJobs = await loadInProgressJobs(repo, summaries);

  return { recentTastings, tasteProfile, recentAgreementScores, latestDiscoveries, inProgressJobs };
}

const IN_PROGRESS_JOB_STATUSES: ReadonlySet<Job['status']> = new Set([
  'queued',
  'transcribing',
  'analyzing',
]);

async function loadInProgressJobs(
  repo: Repository,
  summaries: TastingSummaryView[],
): Promise<InProgressJobView[]> {
  const results: InProgressJobView[] = [];
  for (const summary of summaries) {
    const job = await repo.getJob(summary.tastingId);
    if (job && IN_PROGRESS_JOB_STATUSES.has(job.status)) {
      results.push({
        tastingId: summary.tastingId,
        wineName: summary.wineName,
        status: job.status,
        estimatedSec: job.estimatedSec,
      });
    }
  }
  return results;
}

/* ── 14.2 시음 상세 ───────────────────────────────────────────── */

export interface TastingDetailView {
  tasting: Tasting;
  wine?: Wine;
  winery?: Winery;
  regionPath: string[];
  recordings: Recording[];
  analysis?: Analysis;
  job?: Job;
  /** 같은 와인의 과거 기록(현재 시음 제외, 시간순) */
  pastTastingsForWine: TastingSummaryView[];
  fit: FitLevel;
  /**
   * 화면에 표시할 **대표 평점 하나**.
   * AI 가 음성 분석으로 먼저 판단하고, 편집자가 수동 평점을 넣으면 그것이 우선한다.
   * 두 값은 각각 보존되지만(`Tasting.manualRating`, `Analysis.aiRating`) 화면에는 하나만 노출한다.
   */
  displayRating?: number;
  ratingSource?: 'manual' | 'ai';
}

/** 시음 상세 화면 데이터 조합 (14.2) */
export async function getTastingDetailView(
  repo: Repository,
  tastingId: string,
): Promise<TastingDetailView | undefined> {
  const bundle = await repo.queryTastingBundle(tastingId);
  if (!bundle.meta) return undefined;

  const tasting = bundle.meta;
  const [wine, { regions }, profile] = await Promise.all([
    tasting.wineId ? repo.getWine(tasting.wineId) : Promise.resolve(undefined),
    loadCatalog(repo),
    getRawTasteProfile(repo),
  ]);

  const winery = wine?.wineryId ? await repo.getWinery(wine.wineryId) : undefined;
  const path = wine?.regionId ? regionPath(regions, wine.regionId) : [];

  const allTastingsForWine = tasting.wineId
    ? (await listTastingsForWine(repo, tasting.wineId)).items
    : [];
  const pastTastingsForWine = allTastingsForWine.filter((t) => t.tastingId !== tastingId);

  const fitInput: FitAssessmentWineInput = {
    grapes: wine?.grapes,
    country: wine?.country,
    // 카탈로그 참조가 없으면 자유 텍스트 지역명으로 적합도를 판단한다
    regionName: wine?.regionId
      ? (regionDisplayName(new Map(regions.map((r) => [r.id, r])), wine.regionId) ??
        wine.regionName)
      : wine?.regionName,
    priceBand: tasting.priceBand,
  };
  const fit = profile ? assessFit(profile, fitInput) : 'unknown';

  return {
    tasting,
    wine,
    winery,
    regionPath: path,
    recordings: bundle.recordings,
    analysis: bundle.analysis,
    job: bundle.job,
    pastTastingsForWine,
    fit,
    // 대표 평점: 수동 평점이 있으면 그것, 없으면 AI 평점
    displayRating: tasting.manualRating ?? bundle.analysis?.aiRating,
    ratingSource:
      tasting.manualRating !== undefined
        ? 'manual'
        : bundle.analysis?.aiRating !== undefined
          ? 'ai'
          : undefined,
  };
}

/* ── 14.4 와인 목록·상세 ──────────────────────────────────────── */

export interface WineListItemView extends WineSummaryView {
  tastingCount: number;
  meanRating?: number;
  /** 초안 와인 — 라벨 인식 결과로 자동 생성되어 아직 확인되지 않았다 */
  draft: boolean;
}

/** 와인 목록 조회 — 검색어가 있으면 이름·와이너리·지역·품종 부분일치로 필터링한다 (14.4) */
export async function getWineListView(
  repo: Repository,
  query?: string,
): Promise<WineListItemView[]> {
  const { wines, wineryById, regionById } = await loadCatalog(repo);
  const { items: allTastings } = await repo.listByType<Tasting>('TASTING', 'asc');

  const tastingsByWine = new Map<string, Tasting[]>();
  for (const t of allTastings.filter((t): t is Tasting & { wineId: string } => t.wineId !== undefined)) {
    const list = tastingsByWine.get(t.wineId) ?? [];
    list.push(t);
    tastingsByWine.set(t.wineId, list);
  }

  /*
   * 초안 와인(라벨 인식 직후 자동 생성)은 카탈로그 목록에서 숨긴다 —
   * 확정된 와인과 섞이면 목록이 중복·미확인 항목으로 오염된다.
   * 단, 시음 기록이 붙은 초안은 "확인 필요" 대상이므로 노출한다.
   */
  const visibleWines = wines.filter((w) => !w.draft || (tastingsByWine.get(w.id)?.length ?? 0) > 0);

  let filteredWines = visibleWines;
  if (query && query.trim().length > 0) {
    const searchable: SearchableWine[] = visibleWines.map((w) => ({
      wineId: w.id,
      name: w.name,
      // 참조가 없으면 라벨 인식·검색으로 얻은 이름으로도 찾을 수 있게 한다
      wineryName: (w.wineryId ? wineryById.get(w.wineryId)?.name : undefined) ?? w.wineryName,
      regionName: regionDisplayName(regionById, w.regionId) ?? w.regionName,
      grapes: w.grapes,
    }));
    const matches = matchWines(searchable, query);
    const matchedIds = new Set(matches.map((m) => m.wineId));
    filteredWines = visibleWines.filter((w) => matchedIds.has(w.id));
  }

  const items: WineListItemView[] = [];
  for (const wine of filteredWines) {
    const wineTastings = tastingsByWine.get(wine.id) ?? [];
    const ratings: number[] = [];
    for (const t of wineTastings) {
      if (t.manualRating !== undefined) {
        ratings.push(t.manualRating);
      } else {
        const analysis = await repo.getAnalysis(t.id);
        if (analysis?.aiRating !== undefined) ratings.push(analysis.aiRating);
      }
    }
    const meanRating =
      ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : undefined;

    items.push({
      ...toWineSummary(wine, wineryById, regionById),
      tastingCount: wineTastings.length,
      meanRating,
      draft: wine.draft,
    });
  }

  return items;
}

export interface RatingTrendPoint {
  tastingId: string;
  tastedAt: string;
  rating: number;
  ratingSource: 'manual' | 'ai';
}

export interface WineDetailView {
  wine: Wine;
  winery?: Winery;
  regionPath: string[];
  /** 시간순(오래된 → 최신) 시음 이력 */
  tastingHistory: TastingSummaryView[];
  /** 평점 추이 (시간순, 평점이 있는 시음만) */
  ratingTrend: RatingTrendPoint[];
  fit: FitLevel;
}

/** 와인 상세 화면 데이터 조합 — 시음 이력 시간순 + 평점 추이 (14.4) */
export async function getWineDetailView(
  repo: Repository,
  wineId: string,
): Promise<WineDetailView | undefined> {
  const wine = await repo.getWine(wineId);
  if (!wine) return undefined;

  const [winery, { regions }, { items: history }, profile] = await Promise.all([
    wine.wineryId ? repo.getWinery(wine.wineryId) : Promise.resolve(undefined),
    loadCatalog(repo),
    listTastingsForWine(repo, wineId),
    getRawTasteProfile(repo),
  ]);

  const path = wine.regionId ? regionPath(regions, wine.regionId) : [];

  const ratingTrend: RatingTrendPoint[] = history
    .filter((t) => t.displayRating !== undefined)
    .map((t) => ({
      tastingId: t.tastingId,
      tastedAt: t.tastedAt,
      rating: t.displayRating!,
      ratingSource: t.ratingSource!,
    }));

  const fitInput: FitAssessmentWineInput = {
    grapes: wine.grapes,
    country: wine.country,
    regionName:
      regionDisplayName(new Map(regions.map((r) => [r.id, r])), wine.regionId) ?? wine.regionName,
  };
  const fit = profile ? assessFit(profile, fitInput) : 'unknown';

  return { wine, winery, regionPath: path, tastingHistory: history, ratingTrend, fit };
}

/** 특정 와인의 시음 이력을 시간순(오래된 → 최신)으로 조회한다 */
async function listTastingsForWine(
  repo: Repository,
  wineId: string,
): Promise<{ items: TastingSummaryView[] }> {
  const { items: allTastings } = await repo.listByType<Tasting>('TASTING', 'asc');
  const wine = await repo.getWine(wineId);
  const relevant = allTastings
    .filter((t): t is Tasting & { wineId: string } => isPublishedTasting(t) && t.wineId === wineId)
    .sort((a, b) => a.tastedAt.localeCompare(b.tastedAt));

  const items: TastingSummaryView[] = [];
  for (const t of relevant) {
    const analysis = await repo.getAnalysis(t.id);
    items.push(toTastingSummary(t, wine, analysis));
  }
  return { items };
}

/* ── 14.5 지역 계층 탐색 ──────────────────────────────────────── */

export interface ExploreView {
  /** 루트부터 현재 경로까지의 트리(브레드크럼 계산용) */
  breadcrumb: { id: string; name: string }[];
  /** 현재 위치에서 보여줄 하위 노드들 (없으면 루트 목록) */
  children: RegionTreeNode[];
  /** 현재 위치가 세부 산지(leaf)면 해당 지역에 속한 와인 목록 */
  winesInRegion: WineSummaryView[];
  /** path 가 존재하지 않는 지역을 가리키면 true */
  notFound: boolean;
}

/**
 * 국가 > 지역 > 세부 산지 경로 탐색 (14.5).
 * `path` 는 지역 id 배열이다. 빈 배열이면 최상위(국가) 목록을 반환한다.
 */
export async function getExploreView(repo: Repository, path: string[]): Promise<ExploreView> {
  const { regions, wines, wineryById, regionById } = await loadCatalog(repo);
  const tree = buildRegionTree(regions);

  if (path.length === 0) {
    return { breadcrumb: [], children: tree, winesInRegion: [], notFound: false };
  }

  let currentNodes = tree;
  let currentNode: RegionTreeNode | undefined;
  const breadcrumb: { id: string; name: string }[] = [];

  for (const segmentId of path) {
    currentNode = currentNodes.find((n) => n.id === segmentId);
    if (!currentNode) {
      return { breadcrumb, children: [], winesInRegion: [], notFound: true };
    }
    breadcrumb.push({ id: currentNode.id, name: currentNode.name });
    currentNodes = currentNode.children;
  }

  const winesInRegion = currentNode
    ? wines
        .filter((w) => w.regionId === currentNode!.id)
        .map((w) => toWineSummary(w, wineryById, regionById))
    : [];

  return { breadcrumb, children: currentNodes, winesInRegion, notFound: false };
}

/* ── 14.6 타임라인·와이너리·랭킹 ──────────────────────────────── */

/** 타임라인 뷰 — 날짜 내림차순 전체 시음 목록 (14.6) */
export async function getTimelineView(repo: Repository): Promise<TastingSummaryView[]> {
  const { summaries } = await loadAllTastingSummaries(repo);
  return summaries;
}

export interface WineryDetailView {
  winery: Winery;
  regionPath: string[];
  wines: WineSummaryView[];
}

/** 와이너리별 뷰 (14.6) */
export async function getWineryDetailView(
  repo: Repository,
  wineryId: string,
): Promise<WineryDetailView | undefined> {
  const winery = await repo.getWinery(wineryId);
  if (!winery) return undefined;

  const { wines, wineryById, regionById, regions } = await loadCatalog(repo);
  const path = winery.regionId ? regionPath(regions, winery.regionId) : [];
  const wineryWines = wines
    .filter((w) => w.wineryId === wineryId)
    .map((w) => toWineSummary(w, wineryById, regionById));

  return { winery, regionPath: path, wines: wineryWines };
}

export interface RankingItemView {
  tastingId: string;
  wineId: string;
  wineName: string;
  vintage?: number;
  tastedAt: string;
  /** 최종 평점 — 수동 평점이 있으면 그것, 없으면 AI 평점 */
  rating: number;
  ratingSource: 'manual' | 'ai';
}

/**
 * 평점순 랭킹 뷰 (14.6).
 *
 * AI 랭킹과 수동 랭킹을 나누지 않고 **최종 평점 하나**로 줄을 세운다.
 * AI 가 먼저 판단하고, 편집자가 수동 평점을 넣으면 그것이 우선한다
 * (상세·목록 화면의 대표 평점과 같은 규칙).
 */
export async function getRankingsView(repo: Repository): Promise<RankingItemView[]> {
  const { summaries } = await loadAllTastingSummaries(repo);

  const items: RankingItemView[] = [];
  for (const s of summaries) {
    if (s.displayRating === undefined || s.ratingSource === undefined) continue;
    items.push({
      tastingId: s.tastingId,
      wineId: s.wineId,
      wineName: s.wineName,
      vintage: s.vintage,
      tastedAt: s.tastedAt,
      rating: s.displayRating,
      ratingSource: s.ratingSource,
    });
  }

  items.sort((a, b) =>
    b.rating !== a.rating ? b.rating - a.rating : b.tastedAt.localeCompare(a.tastedAt),
  );
  return items;
}

/* ── 12.4/12.6 취향 프로파일 뷰 ───────────────────────────────── */

export interface TasteProfileView {
  active: boolean;
  tastingCount: number;
  /** 0~1 진행률 (비활성 시에만 의미 있음) */
  progress: number;
  axes?: TasteProfile['axes'];
  liked: TasteProfile['liked'];
  disliked: TasteProfile['disliked'];
  keywords: string[];
  narrative?: string;
  recommendations: TasteProfile['recommendations'];
  shoppingGuide?: string;
  /** 월별 반응 일치도 추이 (12.6) — 저장된 값이 있으면 그것을, 없으면 즉석 계산한다 */
  agreementTrend: TasteProfile['agreementTrend'];
}

async function getRawTasteProfile(repo: Repository): Promise<TasteProfile | undefined> {
  return repo.getProfile();
}

/** 취향 프로파일 뷰 조합 (12.4: 5축 레이더 + 키워드, 5건 미달 시 진행률 / 12.6: 월별 반응 일치도 추이) */
export async function getTasteProfileView(repo: Repository): Promise<TasteProfileView> {
  const profile = await repo.getProfile();

  if (!profile) {
    return {
      active: false,
      tastingCount: 0,
      progress: 0,
      liked: [],
      disliked: [],
      keywords: [],
      recommendations: [],
      agreementTrend: [],
    };
  }

  let agreementTrend = profile.agreementTrend;
  if (agreementTrend.length === 0) {
    // 저장된 추이가 비어 있으면(아직 에이전트가 채우지 않았거나 재계산 전) 원자료로 즉석 계산한다.
    agreementTrend = await computeAgreementTrendFromTastings(repo);
  }

  return {
    active: profile.active,
    tastingCount: profile.tastingCount,
    progress: profile.progress,
    axes: profile.axes,
    liked: profile.liked,
    disliked: profile.disliked,
    keywords: profile.keywords,
    narrative: profile.narrative,
    recommendations: profile.recommendations,
    shoppingGuide: profile.shoppingGuide,
    agreementTrend,
  };
}

async function computeAgreementTrendFromTastings(
  repo: Repository,
): Promise<TasteProfile['agreementTrend']> {
  const { items: tastings } = await repo.listByType<Tasting>('TASTING', 'asc');
  const entries: AgreementEntry[] = [];
  for (const t of tastings) {
    const analysis = await repo.getAnalysis(t.id);
    if (analysis?.agreementScore !== undefined) {
      entries.push({ at: t.tastedAt, score: analysis.agreementScore });
    }
  }
  return aggregateByMonth(entries);
}

/* ── 13.6 발견 카드 뷰 ────────────────────────────────────────── */

export interface DiscoveryView {
  id: string;
  alias: string;
  description: string;
  n: number;
  grade: Discovery['grade'];
  disclaimer: string;
  evidenceTastingIds: string[];
  updatedFromN?: number;
  createdAt: string;
}

function toDiscoveryView(discovery: Discovery): DiscoveryView {
  return {
    id: discovery.id,
    alias: discovery.alias,
    description: discovery.description,
    n: discovery.n,
    grade: discovery.grade,
    disclaimer: discovery.disclaimer,
    evidenceTastingIds: discovery.evidenceTastingIds,
    updatedFromN: discovery.updatedFromN,
    createdAt: discovery.createdAt,
  };
}

/** 발견 카드 전체 목록 (숨김 제외, 최신순) — 13.6 */
export async function getDiscoveriesView(repo: Repository): Promise<DiscoveryView[]> {
  const { items } = await repo.listByType<Discovery>('DISCOVERY', 'desc');
  return items.filter((d) => !d.hidden).map(toDiscoveryView);
}
