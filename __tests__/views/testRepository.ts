/**
 * __tests__/views/testRepository.ts — lib/views/read.ts 테스트용 인메모리 Repository.
 *
 * Repository 인터페이스(lib/db/repository.ts)를 그대로 구현하되, DynamoDB 대신
 * 메모리 Map 을 사용한다. 실제 DB 접근이 없어 순수 뷰 조합 로직만 검증할 수 있다.
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
import type {
  ListableType,
  ListOrder,
  ListResult,
  Repository,
  ScanAllResult,
  TastingBundle,
} from '@/lib/db/repository';

/** 낙관적 동시성 검사 없이 단순 저장/조회만 지원하는 테스트용 인메모리 리포지토리 */
export class InMemoryRepository implements Repository {
  wines = new Map<string, Wine>();
  wineries = new Map<string, Winery>();
  regions = new Map<string, Region>();
  tastings = new Map<string, Tasting>();
  recordings = new Map<string, Recording[]>();
  analyses = new Map<string, Analysis>();
  jobs = new Map<string, Job>();
  profile: TasteProfile | undefined;
  discoveries = new Map<string, Discovery>();

  async getWine(id: string) {
    return this.wines.get(id);
  }
  async putWine(wine: Wine) {
    this.wines.set(wine.id, wine);
  }
  async patchWine(id: string, _expectedRev: number, patch: Partial<Wine>) {
    const existing = this.wines.get(id)!;
    const updated = { ...existing, ...patch, rev: existing.rev + 1 };
    this.wines.set(id, updated);
    return updated;
  }
  async deleteWine(id: string) {
    this.wines.delete(id);
  }

  async getWinery(id: string) {
    return this.wineries.get(id);
  }
  async putWinery(winery: Winery) {
    this.wineries.set(winery.id, winery);
  }
  async patchWinery(id: string, _expectedRev: number, patch: Partial<Winery>) {
    const existing = this.wineries.get(id)!;
    const updated = { ...existing, ...patch, rev: existing.rev + 1 };
    this.wineries.set(id, updated);
    return updated;
  }
  async deleteWinery(id: string) {
    this.wineries.delete(id);
  }

  async getRegion(id: string) {
    return this.regions.get(id);
  }
  async putRegion(region: Region) {
    this.regions.set(region.id, region);
  }
  async patchRegion(id: string, _expectedRev: number, patch: Partial<Region>) {
    const existing = this.regions.get(id)!;
    const updated = { ...existing, ...patch, rev: existing.rev + 1 };
    this.regions.set(id, updated);
    return updated;
  }
  async deleteRegion(id: string) {
    this.regions.delete(id);
  }

  async getTasting(id: string) {
    return this.tastings.get(id);
  }
  async putTasting(tasting: Tasting) {
    this.tastings.set(tasting.id, tasting);
  }
  async patchTasting(id: string, _expectedRev: number, patch: Partial<Tasting>) {
    const existing = this.tastings.get(id)!;
    const updated = { ...existing, ...patch, rev: existing.rev + 1 };
    this.tastings.set(id, updated);
    return updated;
  }
  async deleteTasting(id: string) {
    this.tastings.delete(id);
  }

  async getRecording(tastingId: string, recordingId: string) {
    return this.recordings.get(tastingId)?.find((r) => r.id === recordingId);
  }
  async putRecording(recording: Recording) {
    const list = this.recordings.get(recording.tastingId) ?? [];
    this.recordings.set(recording.tastingId, [
      ...list.filter((r) => r.id !== recording.id),
      recording,
    ]);
  }
  async patchRecording(
    tastingId: string,
    recordingId: string,
    _expectedRev: number,
    patch: Partial<Recording>,
  ) {
    const list = this.recordings.get(tastingId) ?? [];
    const existing = list.find((r) => r.id === recordingId)!;
    const updated = { ...existing, ...patch, rev: existing.rev + 1 };
    this.recordings.set(tastingId, [...list.filter((r) => r.id !== recordingId), updated]);
    return updated;
  }
  async deleteRecording(tastingId: string, recordingId: string) {
    const list = this.recordings.get(tastingId) ?? [];
    this.recordings.set(
      tastingId,
      list.filter((r) => r.id !== recordingId),
    );
  }

  async getAnalysis(tastingId: string) {
    return this.analyses.get(tastingId);
  }
  async putAnalysis(analysis: Analysis) {
    this.analyses.set(analysis.tastingId, analysis);
  }
  async patchAnalysis(tastingId: string, _expectedRev: number, patch: Partial<Analysis>) {
    const existing = this.analyses.get(tastingId)!;
    const updated = { ...existing, ...patch };
    this.analyses.set(tastingId, updated);
    return updated;
  }
  async deleteAnalysis(tastingId: string) {
    this.analyses.delete(tastingId);
  }

  async getJob(tastingId: string) {
    return this.jobs.get(tastingId);
  }
  async putJob(job: Job) {
    this.jobs.set(job.tastingId, job);
  }
  async patchJob(tastingId: string, _expectedRev: number, patch: Partial<Job>) {
    const existing = this.jobs.get(tastingId)!;
    const updated = { ...existing, ...patch, rev: existing.rev + 1 };
    this.jobs.set(tastingId, updated);
    return updated;
  }
  async deleteJob(tastingId: string) {
    this.jobs.delete(tastingId);
  }

  async getProfile() {
    return this.profile;
  }
  async putProfile(profile: TasteProfile) {
    this.profile = profile;
  }
  async patchProfile(_expectedRev: number, patch: Partial<TasteProfile>) {
    this.profile = { ...this.profile!, ...patch, rev: this.profile!.rev + 1 };
    return this.profile;
  }

  async getDiscovery(id: string) {
    return this.discoveries.get(id);
  }
  async putDiscovery(discovery: Discovery) {
    this.discoveries.set(discovery.id, discovery);
  }
  async patchDiscovery(id: string, _expectedRev: number, patch: Partial<Discovery>) {
    const existing = this.discoveries.get(id)!;
    const updated = { ...existing, ...patch, rev: existing.rev + 1 };
    this.discoveries.set(id, updated);
    return updated;
  }
  async deleteDiscovery(id: string) {
    this.discoveries.delete(id);
  }

  async queryTastingBundle(tastingId: string): Promise<TastingBundle> {
    return {
      meta: this.tastings.get(tastingId),
      recordings: this.recordings.get(tastingId) ?? [],
      analysis: this.analyses.get(tastingId),
      job: this.jobs.get(tastingId),
      quarantined: [],
    };
  }

  async listByType<T>(type: ListableType, order: ListOrder): Promise<ListResult<T>> {
    let items: unknown[];
    switch (type) {
      case 'WINE':
        items = [...this.wines.values()];
        break;
      case 'WINERY':
        items = [...this.wineries.values()];
        break;
      case 'REGION':
        items = [...this.regions.values()];
        break;
      case 'TASTING':
        items = [...this.tastings.values()];
        break;
      case 'DISCOVERY':
        items = [...this.discoveries.values()];
        break;
      default:
        items = [];
    }

    // 시음/발견카드는 시간 필드 기준 정렬, 그 외는 입력 순서 유지
    const sorted = [...items] as Array<Record<string, unknown>>;
    if (type === 'TASTING') {
      sorted.sort((a, b) => {
        const cmp = String(a['tastedAt']).localeCompare(String(b['tastedAt']));
        return order === 'asc' ? cmp : -cmp;
      });
    } else if (type === 'DISCOVERY') {
      sorted.sort((a, b) => {
        const cmp = String(a['createdAt']).localeCompare(String(b['createdAt']));
        return order === 'asc' ? cmp : -cmp;
      });
    }

    return { items: sorted as T[], quarantined: [] };
  }

  async scanAll<T>(): Promise<ScanAllResult<T>> {
    const items: unknown[] = [
      ...this.wines.values(),
      ...this.wineries.values(),
      ...this.regions.values(),
      ...this.tastings.values(),
      ...[...this.recordings.values()].flat(),
      ...this.analyses.values(),
      ...this.jobs.values(),
      ...this.discoveries.values(),
    ];
    if (this.profile) items.push(this.profile);
    return { items: items as T[], quarantined: [] };
  }
}

/** 필수 필드를 채운 최소 Wine 픽스처 생성 헬퍼 */
export function makeWine(overrides: Partial<Wine> & { id: string; name: string }): Wine {
  return {
    type: 'WINE',
    grapes: [],
    labelTags: [],
    sourceUrls: [],
    draft: false,
    tags: [],
    nameNormalized: overrides.name.toLowerCase(),
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
    ...overrides,
  };
}

/** 필수 필드를 채운 최소 Tasting 픽스처 생성 헬퍼 */
export function makeTasting(
  overrides: Partial<Tasting> & { id: string; wineId: string; tastedAt: string },
): Tasting {
  return {
    type: 'TASTING',
    schemaVersion: 2,
    createdAt: overrides.tastedAt,
    updatedAt: overrides.tastedAt,
    rev: 0,
    ...overrides,
  };
}

/** 필수 필드를 채운 최소 Analysis 픽스처 생성 헬퍼 */
export function makeAnalysis(
  overrides: Partial<Analysis> & { tastingId: string; aiRating: number },
): Analysis {
  return {
    type: 'ANALYSIS',
    summary: '요약',
    highlights: [],
    notes: { acidity: 3, tannin: 3, body: 3, aroma: 3, finish: 3 },
    evidence: [{ field: 'summary', basis: '기본 근거', kind: 'quote' }],
    promptVersion: 'v1',
    modelId: 'test-model',
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
    ...overrides,
  };
}

/** 필수 필드를 채운 최소 Region 픽스처 생성 헬퍼 */
export function makeRegion(
  overrides: Partial<Region> & { id: string; name: string; level: Region['level'] },
): Region {
  return {
    type: 'REGION',
    nameNormalized: overrides.name.toLowerCase(),
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
    ...overrides,
  };
}

/** 필수 필드를 채운 최소 Discovery 픽스처 생성 헬퍼 */
export function makeDiscovery(
  overrides: Partial<Discovery> & { id: string; alias: string; description: string },
): Discovery {
  return {
    type: 'DISCOVERY',
    groupBy: 'grape',
    key: 'Nebbiolo',
    metric: 'meanRating',
    n: 5,
    value: 4.2,
    deltaVsOverall: 0.8,
    grade: 'moderate',
    evidenceTastingIds: [],
    disclaimer: '표본이 적어 우연일 수 있습니다. 기록이 쌓이면 다시 판정합니다.',
    hidden: false,
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
    ...overrides,
  };
}
