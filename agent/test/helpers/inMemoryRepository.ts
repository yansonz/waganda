/**
 * test/helpers/inMemoryRepository.ts — 테스트 전용 인메모리 Repository 구현.
 * AWS 실호출 없이 그래프 노드·도구를 검증하기 위한 스텁이다.
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
  ListOrder,
  ListResult,
  ListableType,
  Repository,
  ScanAllResult,
  TastingBundle,
} from '@app/db/repository';

/** pk/sk 를 key 로 쓰는 단순 맵 기반 인메모리 저장소 */
export class InMemoryRepository implements Repository {
  private wines = new Map<string, Wine>();
  private wineries = new Map<string, Winery>();
  private regions = new Map<string, Region>();
  private tastings = new Map<string, Tasting>();
  private recordings = new Map<string, Recording>();
  private analyses = new Map<string, Analysis>();
  private jobs = new Map<string, Job>();
  private profile: TasteProfile | undefined;
  private discoveries = new Map<string, Discovery>();

  async getWine(id: string) {
    return this.wines.get(id);
  }
  async putWine(wine: Wine) {
    this.wines.set(wine.id, wine);
  }
  async patchWine(id: string, expectedRev: number, patch: Partial<Wine>) {
    const existing = this.requireRev(this.wines.get(id), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Wine;
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
  async patchWinery(id: string, expectedRev: number, patch: Partial<Winery>) {
    const existing = this.requireRev(this.wineries.get(id), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Winery;
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
  async patchRegion(id: string, expectedRev: number, patch: Partial<Region>) {
    const existing = this.requireRev(this.regions.get(id), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Region;
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
  async patchTasting(id: string, expectedRev: number, patch: Partial<Tasting>) {
    const existing = this.requireRev(this.tastings.get(id), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Tasting;
    this.tastings.set(id, updated);
    return updated;
  }
  async deleteTasting(id: string) {
    this.tastings.delete(id);
  }

  private recordingKey(tastingId: string, recordingId: string) {
    return `${tastingId}#${recordingId}`;
  }

  async getRecording(tastingId: string, recordingId: string) {
    return this.recordings.get(this.recordingKey(tastingId, recordingId));
  }
  async putRecording(recording: Recording) {
    this.recordings.set(this.recordingKey(recording.tastingId, recording.id), recording);
  }
  async patchRecording(
    tastingId: string,
    recordingId: string,
    expectedRev: number,
    patch: Partial<Recording>,
  ) {
    const key = this.recordingKey(tastingId, recordingId);
    const existing = this.requireRev(this.recordings.get(key), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Recording;
    this.recordings.set(key, updated);
    return updated;
  }
  async deleteRecording(tastingId: string, recordingId: string) {
    this.recordings.delete(this.recordingKey(tastingId, recordingId));
  }

  async getAnalysis(tastingId: string) {
    return this.analyses.get(tastingId);
  }
  async putAnalysis(analysis: Analysis) {
    this.analyses.set(analysis.tastingId, analysis);
  }
  async patchAnalysis(tastingId: string, expectedRev: number, patch: Partial<Analysis>) {
    const existing = this.requireRev(this.analyses.get(tastingId), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Analysis;
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
  async patchJob(tastingId: string, expectedRev: number, patch: Partial<Job>) {
    const existing = this.requireRev(this.jobs.get(tastingId), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Job;
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
  async patchProfile(expectedRev: number, patch: Partial<TasteProfile>) {
    const existing = this.requireRev(this.profile, expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as TasteProfile;
    this.profile = updated;
    return updated;
  }

  async getDiscovery(id: string) {
    return this.discoveries.get(id);
  }
  async putDiscovery(discovery: Discovery) {
    this.discoveries.set(discovery.id, discovery);
  }
  async patchDiscovery(id: string, expectedRev: number, patch: Partial<Discovery>) {
    const existing = this.requireRev(this.discoveries.get(id), expectedRev);
    const updated = { ...existing, ...patch, rev: expectedRev + 1 } as Discovery;
    this.discoveries.set(id, updated);
    return updated;
  }
  async deleteDiscovery(id: string) {
    this.discoveries.delete(id);
  }

  async queryTastingBundle(tastingId: string): Promise<TastingBundle> {
    const meta = this.tastings.get(tastingId);
    const recordings = [...this.recordings.values()].filter((r) => r.tastingId === tastingId);
    const analysis = this.analyses.get(tastingId);
    const job = this.jobs.get(tastingId);
    return { meta, recordings, analysis, job, quarantined: [] };
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
    const sorted = [...items] as Array<{ createdAt?: string }>;
    sorted.sort((a, b) => {
      const cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
      return order === 'asc' ? cmp : -cmp;
    });
    return { items: sorted as T[], quarantined: [] };
  }

  async scanAll<T>(): Promise<ScanAllResult<T>> {
    const items: unknown[] = [
      ...this.wines.values(),
      ...this.wineries.values(),
      ...this.regions.values(),
      ...this.tastings.values(),
      ...this.recordings.values(),
      ...this.analyses.values(),
      ...this.jobs.values(),
      ...this.discoveries.values(),
      ...(this.profile ? [this.profile] : []),
    ];
    return { items: items as T[], quarantined: [] };
  }

  private requireRev<T extends { rev: number }>(value: T | undefined, expectedRev: number): T {
    if (!value) {
      throw new Error('대상 레코드를 찾을 수 없습니다 (인메모리 스텁).');
    }
    if (value.rev !== expectedRev) {
      throw new Error(`rev 충돌: expected=${expectedRev}, actual=${value.rev}`);
    }
    return value;
  }
}
