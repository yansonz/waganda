/**
 * E2E 시드 스크립트.
 *
 * **모든 레코드를 실제 Zod 스키마로 파싱해 검증한 뒤** 넣는다.
 * 스키마와 어긋난 레코드는 리더가 격리(quarantine)해 화면이 빈 상태로 렌더되므로,
 * 시드가 스키마를 통과하는 것 자체가 E2E 의 전제 조건이다.
 *
 * 실행: npx tsx e2e/fixtures/seed.ts
 */
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  Analysis,
  CURRENT_SCHEMA_VERSION,
  Discovery,
  Region,
  TasteProfile,
  Tasting,
  Wine,
  Winery,
} from '../../packages/schemas/src/index';
import {
  ANALYSIS_SK,
  DISCOVERY_SK,
  PROFILE_PK,
  PROFILE_SK,
  REGION_SK,
  TASTING_META_SK,
  WINERY_SK,
  WINE_SK,
  discoveryGsi1,
  discoveryPk,
  normalizeName,
  regionGsi1,
  regionPk,
  tastingGsi1,
  tastingPk,
  wineGsi1,
  winePk,
  wineryGsi1,
  wineryPk,
} from '../../lib/db/keys';

const ENDPOINT = process.env.WAGANDA_DDB_ENDPOINT ?? 'http://127.0.0.1:9000';
const TABLE_NAME = process.env.WAGANDA_TABLE_NAME ?? 'waganda-local';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

/** E2E 단정에서 참조하는 고정 식별자·이름 */
export const SEED = {
  /** 분석 완료 시음의 수동 평점 (표시 우선) */
  manualRating: 4.5,
  /** 같은 시음의 AI 평점 (보존되지만 화면에는 노출하지 않는다) */
  aiRating: 3.5,
  regionFranceId: 'region-france',
  regionBordeauxId: 'region-bordeaux',
  wineryId: 'winery-margaux',
  wineId: 'wine-margaux-2015',
  wineName: 'Château Margaux 2015',
  secondWineId: 'wine-cloudy-bay',
  secondWineName: 'Cloudy Bay Sauvignon Blanc',
  analyzedTastingId: 'tasting-analyzed-0001',
  pendingTastingId: 'tasting-pending-0001',
  discoveryAlias: '보르도 몰아보기의 법칙',
} as const;

const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function ensureTable(): Promise<void> {
  const { TableNames } = await client.send(new ListTablesCommand({}));
  if (TableNames?.includes(TABLE_NAME)) {
    console.log(`[seed] 테이블 ${TABLE_NAME} 재사용`);
    return;
  }
  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
        { AttributeName: 'gsi1sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  console.log(`[seed] 테이블 ${TABLE_NAME} 생성 완료`);
}

/**
 * 테이블을 비운다.
 *
 * E2E 는 알려진 상태에서 시작해야 한다 — 로컬 DB 가 영속화되면서
 * 기록 테스트가 만든 시음이 쌓여 "최근 시음" 단정이 밀렸다.
 *
 * **`WAGANDA_SEED_RESET=1` 일 때만 실행한다.** 같은 시드 스크립트가
 * 개발용 테이블(`waganda-local`)에도 쓰이므로, 실수로 직접 기록한 데이터를 지우면 안 된다.
 */
async function resetTableIfRequested(): Promise<void> {
  if (process.env.WAGANDA_SEED_RESET !== '1') return;

  let removed = 0;
  for (;;) {
    const scanned = await doc.send(new ScanCommand({ TableName: TABLE_NAME, Limit: 200 }));
    const items = scanned.Items ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      await doc.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: item.pk as string, sk: item.sk as string },
        }),
      );
      removed += 1;
    }
    if (!scanned.LastEvaluatedKey) break;
  }

  console.log(`[seed] 테이블 초기화 — ${removed}건 삭제`);
}

const now = new Date();
const nowIso = now.toISOString();
const daysAgo = (n: number): string =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const meta = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  createdAt: nowIso,
  updatedAt: nowIso,
  rev: 0,
};

async function put(keys: Record<string, string>, entity: Record<string, unknown>): Promise<void> {
  await doc.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...keys, ...entity } }));
}

async function seed(): Promise<void> {
  // ── 지역 (국가 > 세부 산지) ──────────────────────────────────────
  const france = Region.parse({
    id: SEED.regionFranceId,
    type: 'REGION',
    name: '프랑스',
    nameNormalized: normalizeName('프랑스'),
    level: 'country',
    country: '프랑스',
    ...meta,
  });
  await put({ pk: regionPk(france.id), sk: REGION_SK, ...regionGsi1('france') }, france);

  const bordeaux = Region.parse({
    id: SEED.regionBordeauxId,
    type: 'REGION',
    name: '보르도',
    nameNormalized: normalizeName('보르도'),
    level: 'region',
    parentId: SEED.regionFranceId,
    country: '프랑스',
    ...meta,
  });
  await put(
    { pk: regionPk(bordeaux.id), sk: REGION_SK, ...regionGsi1('france/bordeaux') },
    bordeaux,
  );

  // ── 와이너리 ─────────────────────────────────────────────────────
  const winery = Winery.parse({
    id: SEED.wineryId,
    type: 'WINERY',
    name: 'Château Margaux',
    nameNormalized: normalizeName('Château Margaux'),
    regionId: SEED.regionBordeauxId,
    country: '프랑스',
    ...meta,
  });
  await put({ pk: wineryPk(winery.id), sk: WINERY_SK, ...wineryGsi1(winery.name) }, winery);

  // ── 와인 2종 ─────────────────────────────────────────────────────
  const wine = Wine.parse({
    id: SEED.wineId,
    type: 'WINE',
    name: SEED.wineName,
    nameNormalized: normalizeName(SEED.wineName),
    vintage: 2015,
    wineType: 'red',
    wineryId: SEED.wineryId,
    regionId: SEED.regionBordeauxId,
    country: '프랑스',
    grapes: ['Cabernet Sauvignon', 'Merlot'],
    alcoholPercent: 13.5,
    labelTags: ['ornate', 'calligraphy'],
    bottleShape: 'bordeaux',
    closure: 'cork',
    sourceUrls: [],
    draft: false,
    tags: [],
    ...meta,
  });
  await put({ pk: winePk(wine.id), sk: WINE_SK, ...wineGsi1(wine.name) }, wine);

  const wine2 = Wine.parse({
    id: SEED.secondWineId,
    type: 'WINE',
    name: SEED.secondWineName,
    nameNormalized: normalizeName(SEED.secondWineName),
    vintage: 2023,
    wineType: 'white',
    regionId: SEED.regionFranceId,
    grapes: ['Sauvignon Blanc'],
    labelTags: ['minimal'],
    bottleShape: 'alsace',
    closure: 'screwcap',
    sourceUrls: [],
    draft: false,
    ...meta,
  });
  await put({ pk: winePk(wine2.id), sk: WINE_SK, ...wineGsi1(wine2.name) }, wine2);

  // ── 시음 2건 (1건 분석 완료, 1건 대기) ───────────────────────────
  const analyzedTasting = Tasting.parse({
    id: SEED.analyzedTastingId,
    type: 'TASTING',
    wineId: SEED.wineId,
    tastedAt: daysAgo(3),
    priceKrw: 120_000,
    priceBand: '100k_200k',
    manualRating: 4.5,
    ...meta,
  });
  await put(
    {
      pk: tastingPk(analyzedTasting.id),
      sk: TASTING_META_SK,
      ...tastingGsi1(analyzedTasting.tastedAt, analyzedTasting.id),
    },
    analyzedTasting,
  );

  const pendingTasting = Tasting.parse({
    id: SEED.pendingTastingId,
    type: 'TASTING',
    wineId: SEED.secondWineId,
    tastedAt: daysAgo(1),
    priceKrw: 35_000,
    priceBand: '20k_50k',
    ...meta,
  });
  await put(
    {
      pk: tastingPk(pendingTasting.id),
      sk: TASTING_META_SK,
      ...tastingGsi1(pendingTasting.tastedAt, pendingTasting.id),
    },
    pendingTasting,
  );

  // ── 분석 결과 ────────────────────────────────────────────────────
  const analysis = Analysis.parse({
    type: 'ANALYSIS',
    tastingId: SEED.analyzedTastingId,
    summary: '첫 잔부터 잘 익은 검은 과실 향이 올라오고, 두 사람 모두 감탄했다.',
    highlights: [
      {
        quote: '와 이거 향이 진짜 좋다',
        note: '개봉 직후 아로마에 대한 강한 긍정 반응',
        atSec: 12,
      },
    ],
    // 수동 평점(4.5)과 다른 값을 넣어 '표시는 수동 우선' 정책을 E2E 로 검증한다
    aiRating: 3.5,
    notes: { acidity: 3.5, tannin: 4, body: 4.5, aroma: 5, finish: 4 },
    evidence: [
      { field: 'aiRating', basis: '두 화자 모두 긍정 감탄사를 반복했다', kind: 'quote', atSec: 12 },
      { field: 'notes.body', basis: '발화 사이 침묵이 3초 이상 이어졌다', kind: 'acoustic' },
    ],
    agreementScore: 88,
    promptVersion: 'sommelier-v1',
    modelId: 'seed-model',
    ...meta,
  });
  await put({ pk: tastingPk(SEED.analyzedTastingId), sk: ANALYSIS_SK }, analysis);

  // ── 발견 카드 ────────────────────────────────────────────────────
  const discovery = Discovery.parse({
    id: 'discovery-bordeaux',
    type: 'DISCOVERY',
    groupBy: 'region',
    key: '보르도',
    alias: SEED.discoveryAlias,
    description: '보르도 와인에서 평균 평점이 전체 평균보다 1.1점 높게 나타난다.',
    metric: 'meanRating',
    n: 6,
    value: 4.4,
    deltaVsOverall: 1.1,
    grade: 'strong',
    evidenceTastingIds: [SEED.analyzedTastingId],
    hidden: false,
    ...meta,
  });
  await put(
    {
      pk: discoveryPk(discovery.id),
      sk: DISCOVERY_SK,
      ...discoveryGsi1(discovery.createdAt, discovery.id),
    },
    discovery,
  );

  // ── 취향 프로파일 (활성) ─────────────────────────────────────────
  const profile = TasteProfile.parse({
    type: 'PROFILE',
    active: true,
    tastingCount: 6,
    progress: 1,
    axes: { acidity: 3.4, tannin: 3.9, body: 4.2, aroma: 4.6, finish: 4 },
    liked: [{ dimension: 'region', key: '보르도', n: 4, meanRating: 4.4, grade: 'solid' }],
    disliked: [
      { dimension: 'grape', key: 'Sauvignon Blanc', n: 2, meanRating: 2, grade: 'reference' },
    ],
    keywords: ['잘 익은 검은 과실', '긴 여운'],
    narrative: '묵직하고 아로마가 풍부한 레드에 특히 좋은 반응을 보인다.',
    recommendations: [{ label: '북부 론 시라', reason: '묵직한 바디와 향신료 향을 좋아한다' }],
    shoppingGuide: '보르도 레드 5만원대 이상이면 대체로 만족한다.',
    agreementTrend: [{ month: nowIso.slice(0, 7), meanScore: 88, n: 1 }],
    ...meta,
  });
  await put({ pk: PROFILE_PK, sk: PROFILE_SK }, profile);

  console.log('[seed] 스키마 검증을 통과한 레코드 10건 삽입 완료');
}

async function main(): Promise<void> {
  await ensureTable();
  await resetTableIfRequested();
  await seed();
}

main().catch((error) => {
  console.error('[seed] 실패:', error);
  process.exit(1);
});
