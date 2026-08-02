import { z } from 'zod';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  Analysis,
  Discovery,
  Job,
  Recording,
  Region,
  Tasting,
  TasteProfile,
  Wine,
  Winery,
  CURRENT_SCHEMA_VERSION,
  sanitizeAnalysisText,
} from '@waganda/schemas';
import { getDocClient } from '@/lib/db/client';
import { getRuntimeConfig } from '@/lib/config';
import { ConflictError, NotFoundError } from '@/lib/db/errors';
import {
  ANALYSIS_SK,
  DISCOVERY_SK,
  JOB_SK,
  PROFILE_PK,
  PROFILE_SK,
  REGION_SK,
  TASTING_META_SK,
  WINE_SK,
  WINERY_SK,
  discoveryGsi1,
  discoveryPk,
  jobGsi1,
  parseKey,
  recordingSk,
  regionGsi1,
  regionPk,
  tastingGsi1,
  tastingPk,
  wineGsi1,
  winePk,
  wineryGsi1,
  wineryPk,
  GSI1_INDEX_NAME,
} from '@/lib/db/keys';
import { upcastMany, type QuarantinedRecord } from '@/lib/db/upcast';

/* ── 공통 타입 ─────────────────────────────────────────────────────── */

/** DynamoDB 원시 아이템 (pk/sk 포함) */
export type RawItem = Record<string, unknown>;

/** 시음 상세 화면 1회 Query 결과 — Query(pk = TASTING#<id>) 로 한 번에 얻는다 */
export interface TastingBundle {
  meta?: Tasting;
  recordings: Recording[];
  analysis?: Analysis;
  job?: Job;
  quarantined: QuarantinedRecord[];
}

/** GSI1 목록 조회 정렬 순서 */
export type ListOrder = 'asc' | 'desc';

/** GSI1 `TYPE#*` 목록 조회 대상 */
export type ListableType = 'WINE' | 'WINERY' | 'REGION' | 'TASTING' | 'DISCOVERY';

/** listByType 이 여러 스키마를 다룰 수 있도록 결과에서 격리분을 함께 반환한다 */
export interface ListResult<T> {
  items: T[];
  quarantined: QuarantinedRecord[];
}

export interface ScanAllResult<T> {
  items: T[];
  quarantined: QuarantinedRecord[];
}

/**
 * 스토리지 교체 가능성을 위한 리포지토리 인터페이스.
 * DynamoDB 이외의 구현(예: 테스트용 인메모리)으로 바꿀 수 있도록 계약만 정의한다.
 */
export interface Repository {
  // 와인
  getWine(id: string): Promise<Wine | undefined>;
  putWine(wine: Wine): Promise<void>;
  patchWine(id: string, expectedRev: number, patch: Partial<Wine>): Promise<Wine>;
  deleteWine(id: string): Promise<void>;

  // 와이너리
  getWinery(id: string): Promise<Winery | undefined>;
  putWinery(winery: Winery): Promise<void>;
  patchWinery(id: string, expectedRev: number, patch: Partial<Winery>): Promise<Winery>;
  deleteWinery(id: string): Promise<void>;

  // 지역
  getRegion(id: string): Promise<Region | undefined>;
  putRegion(region: Region): Promise<void>;
  patchRegion(id: string, expectedRev: number, patch: Partial<Region>): Promise<Region>;
  deleteRegion(id: string): Promise<void>;

  // 시음 세션 (META)
  getTasting(id: string): Promise<Tasting | undefined>;
  putTasting(tasting: Tasting): Promise<void>;
  patchTasting(id: string, expectedRev: number, patch: Partial<Tasting>): Promise<Tasting>;
  deleteTasting(id: string): Promise<void>;

  // 녹음
  getRecording(tastingId: string, recordingId: string): Promise<Recording | undefined>;
  putRecording(recording: Recording): Promise<void>;
  patchRecording(
    tastingId: string,
    recordingId: string,
    expectedRev: number,
    patch: Partial<Recording>,
  ): Promise<Recording>;
  deleteRecording(tastingId: string, recordingId: string): Promise<void>;

  // 분석 결과
  getAnalysis(tastingId: string): Promise<Analysis | undefined>;
  putAnalysis(analysis: Analysis): Promise<void>;
  patchAnalysis(
    tastingId: string,
    expectedRev: number,
    patch: Partial<Analysis>,
  ): Promise<Analysis>;
  deleteAnalysis(tastingId: string): Promise<void>;

  // 분석 작업
  getJob(tastingId: string): Promise<Job | undefined>;
  putJob(job: Job): Promise<void>;
  patchJob(tastingId: string, expectedRev: number, patch: Partial<Job>): Promise<Job>;
  deleteJob(tastingId: string): Promise<void>;

  // 취향 프로파일 (싱글턴)
  getProfile(): Promise<TasteProfile | undefined>;
  putProfile(profile: TasteProfile): Promise<void>;
  patchProfile(expectedRev: number, patch: Partial<TasteProfile>): Promise<TasteProfile>;

  // 발견 카드
  getDiscovery(id: string): Promise<Discovery | undefined>;
  putDiscovery(discovery: Discovery): Promise<void>;
  patchDiscovery(id: string, expectedRev: number, patch: Partial<Discovery>): Promise<Discovery>;
  deleteDiscovery(id: string): Promise<void>;

  // 접근 패턴
  queryTastingBundle(tastingId: string): Promise<TastingBundle>;
  listByType<T>(type: ListableType, order: ListOrder): Promise<ListResult<T>>;
  scanAll<T>(): Promise<ScanAllResult<T>>;
}

/* ── DynamoDB 구현 ─────────────────────────────────────────────────── */

const SCHEMA_BY_KIND = {
  WINE: Wine,
  WINERY: Winery,
  REGION: Region,
  TASTING: Tasting,
  RECORDING: Recording,
  ANALYSIS: Analysis,
  JOB: Job,
  PROFILE: TasteProfile,
  DISCOVERY: Discovery,
} as const;

export class DynamoDbRepository implements Repository {
  constructor(private readonly client: DynamoDBDocumentClient = getDocClient()) {}

  private get tableName(): string {
    return getRuntimeConfig().tableName;
  }

  /* ── 내부 헬퍼 ───────────────────────────────────────────────── */

  private async getItem(pk: string, sk: string): Promise<RawItem | undefined> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );
    return result.Item as RawItem | undefined;
  }

  private async putItem(item: RawItem): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  private async deleteItem(pk: string, sk: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { pk, sk } }));
  }

  /**
   * rev 대조 낙관적 동시성 patch.
   * 조건: 기존 아이템의 rev == expectedRev 일 때만 갱신하며,
   * 갱신 후 rev 를 +1 하고 updatedAt 을 갱신한다.
   * 조건 실패 시 ConflictError.
   */
  private async patchItem<T extends { rev: number; updatedAt: string }>(
    pk: string,
    sk: string,
    expectedRev: number,
    patch: Partial<T>,
    schema: { parse: (v: unknown) => T },
  ): Promise<T> {
    const now = new Date().toISOString();

    // UpdateCommand 의 SET 표현식을 patch 필드 기준으로 동적 생성한다.
    const updateFields: Record<string, unknown> = {
      ...patch,
      rev: expectedRev + 1,
      updatedAt: now,
    };

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':expectedRev': expectedRev };
    const setClauses: string[] = [];

    let i = 0;
    for (const [field, value] of Object.entries(updateFields)) {
      // patch 는 zod optional 필드를 포함한 객체({ field: undefined } 형태)를 그대로
      // 넘기는 경우가 있다(예: toAnalysisRecord 가 만든 Analysis). undefined 를 그대로
      // ExpressionAttributeValues 에 넣으면 DynamoDB 가 "attribute value is not defined"
      // 로 거부한다(재분석 시 실제로 재현됨). 필드를 명시적으로 지우려면 REMOVE 를
      // 별도로 쓰는 호출부 패턴(patchJob 의 lastError/finishedAt)을 따른다.
      if (value === undefined) continue;

      const nameKey = `#f${i}`;
      const valueKey = `:v${i}`;
      names[nameKey] = field;
      values[valueKey] = value;
      setClauses.push(`${nameKey} = ${valueKey}`);
      i += 1;
    }

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: `SET ${setClauses.join(', ')}`,
          ConditionExpression: 'rev = :expectedRev',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return schema.parse(result.Attributes);
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        throw new ConflictError(undefined, { pk, sk, expectedRev });
      }
      throw err;
    }
  }

  /* ── 와인 ───────────────────────────────────────────────────── */

  async getWine(id: string): Promise<Wine | undefined> {
    const item = await this.getItem(winePk(id), WINE_SK);
    return item ? Wine.parse(item) : undefined;
  }

  async putWine(wine: Wine): Promise<void> {
    const { gsi1pk, gsi1sk } = wineGsi1(wine.nameNormalized || wine.name);
    await this.putItem({ ...wine, pk: winePk(wine.id), sk: WINE_SK, gsi1pk, gsi1sk });
  }

  async patchWine(id: string, expectedRev: number, patch: Partial<Wine>): Promise<Wine> {
    return this.patchItem(winePk(id), WINE_SK, expectedRev, patch, Wine);
  }

  async deleteWine(id: string): Promise<void> {
    await this.deleteItem(winePk(id), WINE_SK);
  }

  /* ── 와이너리 ───────────────────────────────────────────────── */

  async getWinery(id: string): Promise<Winery | undefined> {
    const item = await this.getItem(wineryPk(id), WINERY_SK);
    return item ? Winery.parse(item) : undefined;
  }

  async putWinery(winery: Winery): Promise<void> {
    const { gsi1pk, gsi1sk } = wineryGsi1(winery.nameNormalized || winery.name);
    await this.putItem({ ...winery, pk: wineryPk(winery.id), sk: WINERY_SK, gsi1pk, gsi1sk });
  }

  async patchWinery(id: string, expectedRev: number, patch: Partial<Winery>): Promise<Winery> {
    return this.patchItem(wineryPk(id), WINERY_SK, expectedRev, patch, Winery);
  }

  async deleteWinery(id: string): Promise<void> {
    await this.deleteItem(wineryPk(id), WINERY_SK);
  }

  /* ── 지역 ───────────────────────────────────────────────────── */

  async getRegion(id: string): Promise<Region | undefined> {
    const item = await this.getItem(regionPk(id), REGION_SK);
    return item ? Region.parse(item) : undefined;
  }

  async putRegion(region: Region): Promise<void> {
    const { gsi1pk, gsi1sk } = regionGsi1(region.nameNormalized || region.name);
    await this.putItem({ ...region, pk: regionPk(region.id), sk: REGION_SK, gsi1pk, gsi1sk });
  }

  async patchRegion(id: string, expectedRev: number, patch: Partial<Region>): Promise<Region> {
    return this.patchItem(regionPk(id), REGION_SK, expectedRev, patch, Region);
  }

  async deleteRegion(id: string): Promise<void> {
    await this.deleteItem(regionPk(id), REGION_SK);
  }

  /* ── 시음 세션 ─────────────────────────────────────────────── */

  async getTasting(id: string): Promise<Tasting | undefined> {
    const item = await this.getItem(tastingPk(id), TASTING_META_SK);
    return item ? Tasting.parse(item) : undefined;
  }

  async putTasting(tasting: Tasting): Promise<void> {
    const { gsi1pk, gsi1sk } = tastingGsi1(tasting.tastedAt, tasting.id);
    await this.putItem({
      ...tasting,
      pk: tastingPk(tasting.id),
      sk: TASTING_META_SK,
      gsi1pk,
      gsi1sk,
    });
  }

  async patchTasting(id: string, expectedRev: number, patch: Partial<Tasting>): Promise<Tasting> {
    return this.patchItem(tastingPk(id), TASTING_META_SK, expectedRev, patch, Tasting);
  }

  async deleteTasting(id: string): Promise<void> {
    await this.deleteItem(tastingPk(id), TASTING_META_SK);
  }

  /* ── 녹음 ───────────────────────────────────────────────────── */

  async getRecording(tastingId: string, recordingId: string): Promise<Recording | undefined> {
    const item = await this.getItem(tastingPk(tastingId), recordingSk(recordingId));
    return item ? Recording.parse(item) : undefined;
  }

  async putRecording(recording: Recording): Promise<void> {
    await this.putItem({
      ...recording,
      pk: tastingPk(recording.tastingId),
      sk: recordingSk(recording.id),
    });
  }

  async patchRecording(
    tastingId: string,
    recordingId: string,
    expectedRev: number,
    patch: Partial<Recording>,
  ): Promise<Recording> {
    return this.patchItem(
      tastingPk(tastingId),
      recordingSk(recordingId),
      expectedRev,
      patch,
      Recording,
    );
  }

  async deleteRecording(tastingId: string, recordingId: string): Promise<void> {
    await this.deleteItem(tastingPk(tastingId), recordingSk(recordingId));
  }

  /* ── 분석 결과 ─────────────────────────────────────────────── */

  async getAnalysis(tastingId: string): Promise<Analysis | undefined> {
    const item = await this.getItem(tastingPk(tastingId), ANALYSIS_SK);
    // 모델이 생성한 리터럴 이스케이프(\") 잔여물을 읽기 시점에 정리한다 — 스키마
    // transform 으로 하면 Strands SDK 의 JSON Schema 변환이 깨진다(analysis.ts 참고).
    return item ? sanitizeAnalysisText(Analysis.parse(item)) : undefined;
  }

  async putAnalysis(analysis: Analysis): Promise<void> {
    await this.putItem({
      ...analysis,
      pk: tastingPk(analysis.tastingId),
      sk: ANALYSIS_SK,
    });
  }

  async patchAnalysis(
    tastingId: string,
    expectedRev: number,
    patch: Partial<Analysis>,
  ): Promise<Analysis> {
    return this.patchItem(tastingPk(tastingId), ANALYSIS_SK, expectedRev, patch, Analysis);
  }

  async deleteAnalysis(tastingId: string): Promise<void> {
    await this.deleteItem(tastingPk(tastingId), ANALYSIS_SK);
  }

  /* ── 분석 작업 ─────────────────────────────────────────────── */

  async getJob(tastingId: string): Promise<Job | undefined> {
    const item = await this.getItem(tastingPk(tastingId), JOB_SK);
    return item ? Job.parse(item) : undefined;
  }

  async putJob(job: Job): Promise<void> {
    const { gsi1pk, gsi1sk } = jobGsi1(job.status, job.updatedAt);
    await this.putItem({
      ...job,
      pk: tastingPk(job.tastingId),
      sk: JOB_SK,
      gsi1pk,
      gsi1sk,
    });
  }

  async patchJob(tastingId: string, expectedRev: number, patch: Partial<Job>): Promise<Job> {
    const updated = await this.patchItem(tastingPk(tastingId), JOB_SK, expectedRev, patch, Job);
    // status/updatedAt 이 바뀌면 GSI1 도 함께 갱신해야 하므로 별도 업데이트한다.
    const { gsi1pk, gsi1sk } = jobGsi1(updated.status, updated.updatedAt);
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: tastingPk(tastingId), sk: JOB_SK },
        UpdateExpression: 'SET gsi1pk = :gsi1pk, gsi1sk = :gsi1sk',
        ExpressionAttributeValues: { ':gsi1pk': gsi1pk, ':gsi1sk': gsi1sk },
      }),
    );
    return updated;
  }

  async deleteJob(tastingId: string): Promise<void> {
    await this.deleteItem(tastingPk(tastingId), JOB_SK);
  }

  /* ── 취향 프로파일 ─────────────────────────────────────────── */

  async getProfile(): Promise<TasteProfile | undefined> {
    const item = await this.getItem(PROFILE_PK, PROFILE_SK);
    return item ? TasteProfile.parse(item) : undefined;
  }

  async putProfile(profile: TasteProfile): Promise<void> {
    await this.putItem({ ...profile, pk: PROFILE_PK, sk: PROFILE_SK });
  }

  async patchProfile(expectedRev: number, patch: Partial<TasteProfile>): Promise<TasteProfile> {
    return this.patchItem(PROFILE_PK, PROFILE_SK, expectedRev, patch, TasteProfile);
  }

  /* ── 발견 카드 ─────────────────────────────────────────────── */

  async getDiscovery(id: string): Promise<Discovery | undefined> {
    const item = await this.getItem(discoveryPk(id), DISCOVERY_SK);
    return item ? Discovery.parse(item) : undefined;
  }

  async putDiscovery(discovery: Discovery): Promise<void> {
    const { gsi1pk, gsi1sk } = discoveryGsi1(discovery.createdAt, discovery.id);
    await this.putItem({
      ...discovery,
      pk: discoveryPk(discovery.id),
      sk: DISCOVERY_SK,
      gsi1pk,
      gsi1sk,
    });
  }

  async patchDiscovery(
    id: string,
    expectedRev: number,
    patch: Partial<Discovery>,
  ): Promise<Discovery> {
    return this.patchItem(discoveryPk(id), DISCOVERY_SK, expectedRev, patch, Discovery);
  }

  async deleteDiscovery(id: string): Promise<void> {
    await this.deleteItem(discoveryPk(id), DISCOVERY_SK);
  }

  /* ── 접근 패턴 ─────────────────────────────────────────────── */

  /**
   * 시음 상세 화면 전용 — `Query(pk = TASTING#<id>)` 1회로
   * META(시음 세션)/REC*(녹음)/ANALYSIS(분석 결과)/JOB(작업) 을 모두 가져온다.
   */
  async queryTastingBundle(tastingId: string): Promise<TastingBundle> {
    const items = await this.queryByPk(tastingPk(tastingId));

    const bundle: TastingBundle = { recordings: [], quarantined: [] };

    for (const item of items) {
      const sk = String(item['sk'] ?? '');
      const parsed = parseKey(String(item['pk'] ?? ''), sk);

      switch (parsed.kind) {
        case 'TASTING': {
          const result = Tasting.safeParse(item);
          if (result.success) bundle.meta = result.data;
          else this.warnAndQuarantine(item, result.error, bundle.quarantined);
          break;
        }
        case 'RECORDING': {
          const result = Recording.safeParse(item);
          if (result.success) bundle.recordings.push(result.data);
          else this.warnAndQuarantine(item, result.error, bundle.quarantined);
          break;
        }
        case 'ANALYSIS': {
          const result = Analysis.safeParse(item);
          if (result.success) bundle.analysis = sanitizeAnalysisText(result.data);
          else this.warnAndQuarantine(item, result.error, bundle.quarantined);
          break;
        }
        case 'JOB': {
          const result = Job.safeParse(item);
          if (result.success) bundle.job = result.data;
          else this.warnAndQuarantine(item, result.error, bundle.quarantined);
          break;
        }
        default:
          break;
      }
    }

    return bundle;
  }

  /** GSI1 을 이용한 `TYPE#<type>` 목록 조회 */
  async listByType<T>(type: ListableType, order: ListOrder): Promise<ListResult<T>> {
    const items = await this.queryGsi1(`TYPE#${type}`, order);
    const schema = SCHEMA_BY_KIND[type];
    const { ok, quarantined } = upcastMany(items, schema);
    return { items: ok as T[], quarantined };
  }

  /** 테이블 전체를 페이지네이션으로 모두 순회한다 (전량 Scan 전략) */
  async scanAll<T>(): Promise<ScanAllResult<T>> {
    const items: RawItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...((result.Items as RawItem[] | undefined) ?? []));
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    const quarantined: QuarantinedRecord[] = [];
    const ok: T[] = [];

    for (const item of items) {
      const kind = parseKey(String(item['pk'] ?? ''), String(item['sk'] ?? '')).kind;
      const schema = kind !== 'UNKNOWN' && kind !== 'RATE' ? SCHEMA_BY_KIND[kind] : undefined;
      if (!schema) continue;

      const { ok: parsedOk, quarantined: parsedQuarantined } = upcastMany([item], schema);
      ok.push(...(parsedOk as T[]));
      quarantined.push(...parsedQuarantined);
    }

    return { items: ok, quarantined };
  }

  /* ── 내부 쿼리 헬퍼 ───────────────────────────────────────────── */

  private async queryByPk(pk: string): Promise<RawItem[]> {
    const items: RawItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...((result.Items as RawItem[] | undefined) ?? []));
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }

  private async queryGsi1(gsi1pk: string, order: ListOrder): Promise<RawItem[]> {
    const items: RawItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: GSI1_INDEX_NAME,
          KeyConditionExpression: 'gsi1pk = :gsi1pk',
          ExpressionAttributeValues: { ':gsi1pk': gsi1pk },
          ScanIndexForward: order === 'asc',
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...((result.Items as RawItem[] | undefined) ?? []));
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return items;
  }

  private warnAndQuarantine(raw: unknown, error: z.ZodError, sink: QuarantinedRecord[]): void {
    const reason = error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    console.warn('[lib/db/repository] 레코드 파싱 실패 — 격리 처리:', reason, raw);
    sink.push({ raw, reason });
  }
}

/** DynamoDB `ConditionalCheckFailedException` 여부 판별 (unknown 좁히기) */
function isConditionalCheckFailed(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = 'name' in err ? String((err as { name?: unknown }).name) : undefined;
  return name === 'ConditionalCheckFailedException';
}

/** NotFoundError 를 던지는 get 래퍼 — API 라우트에서 자주 필요한 패턴 */
export function requireFound<T>(value: T | undefined, message?: string): T {
  if (value === undefined) {
    throw new NotFoundError(message);
  }
  return value;
}

/** CURRENT_SCHEMA_VERSION 재노출 — 서비스 계층에서 신규 레코드 생성 시 사용 */
export { CURRENT_SCHEMA_VERSION };
