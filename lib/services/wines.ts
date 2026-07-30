/**
 * lib/services/wines.ts — 와인·와이너리·지역 CRUD 서비스 (6.1).
 *
 * 참조 무결성(`lib/db/integrity.ts`)과 역참조 검증을 API 라우트 대신 이 계층에서
 * 처리해, 라우트는 얇게 유지하고 규칙은 한 곳에 모은다.
 */
import { randomUUID } from 'node:crypto';
import {
  CURRENT_SCHEMA_VERSION,
  type DuplicateCandidate,
  type Region,
  type RegionInput,
  type RegionPatch,
  type Wine,
  type WineInput,
  type WinePatch,
  type Winery,
  type WineryInput,
  type WineryPatch,
} from '@waganda/schemas';
import type { Repository } from '@/lib/db/repository';
import { requireFound } from '@/lib/db/repository';
import {
  assertNoBackrefs,
  assertRefsExist,
  countTastingsForWine,
  refCheck,
} from '@/lib/db/integrity';
import { normalizeName } from '@/lib/db/keys';
import { ReferenceIntegrityError } from '@/lib/db/errors';

/* ── 공통 헬퍼 ─────────────────────────────────────────────────── */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID();
}

/** 특정 와이너리를 참조하는 와인 수 (역참조) */
async function countWinesForWinery(repo: Repository, wineryId: string): Promise<number> {
  const { items } = await repo.scanAll<Record<string, unknown>>();
  return items.filter((item) => item['type'] === 'WINE' && item['wineryId'] === wineryId).length;
}

/** 특정 지역을 참조하는 와인/와이너리/하위지역 수 (역참조) */
async function countRefsForRegion(repo: Repository, regionId: string): Promise<number> {
  const { items } = await repo.scanAll<Record<string, unknown>>();
  return items.filter((item) => {
    const type = item['type'];
    if (type === 'WINE' || type === 'WINERY') return item['regionId'] === regionId;
    if (type === 'REGION') return item['parentId'] === regionId;
    return false;
  }).length;
}

/* ── 와인 ──────────────────────────────────────────────────────── */

/**
 * 이름+빈티지+와이너리 조합으로 중복 후보를 탐색한다.
 * 완전 일치(이름 정규화 기준)를 우선하고, 이름만 같아도 후보로 제시한다.
 */
export async function findDuplicateCandidates(
  repo: Repository,
  input: { name: string; vintage?: number; wineryId?: string },
): Promise<DuplicateCandidate[]> {
  const targetName = normalizeName(input.name);
  const { items: wines } = await repo.listByType<Wine>('WINE', 'asc');

  const candidates: DuplicateCandidate[] = [];

  for (const wine of wines) {
    if (wine.nameNormalized !== targetName) continue;

    const matchedOn: ('name' | 'vintage' | 'winery')[] = ['name'];
    if (input.vintage !== undefined && wine.vintage === input.vintage) {
      matchedOn.push('vintage');
    }
    if (input.wineryId !== undefined && wine.wineryId === input.wineryId) {
      matchedOn.push('winery');
    }

    let wineryName: string | undefined;
    if (wine.wineryId) {
      const winery = await repo.getWinery(wine.wineryId);
      wineryName = winery?.name;
    }

    const tastingCount = await countTastingsForWine(repo, wine.id);

    candidates.push({
      wineId: wine.id,
      name: wine.name,
      vintage: wine.vintage,
      wineryName,
      matchedOn,
      tastingCount,
    });
  }

  return candidates;
}

/** 와인 생성 — 참조 무결성(와이너리·지역 존재) 검증 후 저장한다 */
/**
 * 자유 태그 정리 — 저장 안전장치만 둔다.
 *
 * 표기를 통일(정규화)하지 않는다. 태그는 "있는 그대로" 쌓아 두고,
 * 인사이트는 나중에 LLM 이 전체를 훑어 찾는다("범죄자 초상"·"criminal portrait" 같은
 * 표기 차이도 모델이 묶어 해석한다). 코드가 미리 뭉개면 원문 정보가 사라진다.
 *
 * 여기서 하는 일: 앞뒤 공백 제거, 빈 값·과도하게 긴 값 제외, 완전 중복 제거, 개수 상한.
 */
export function sanitizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag.length === 0 || tag.length > 40) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result.slice(0, 30);
}

export async function createWine(repo: Repository, input: WineInput): Promise<Wine> {
  await assertRefsExist([
    refCheck('wineryId', input.wineryId, async () => {
      if (!input.wineryId) return true;
      return (await repo.getWinery(input.wineryId)) !== undefined;
    }),
    refCheck('regionId', input.regionId, async () => {
      if (!input.regionId) return true;
      return (await repo.getRegion(input.regionId)) !== undefined;
    }),
  ]);

  const now = nowIso();
  const wine: Wine = {
    id: newId(),
    type: 'WINE',
    name: input.name,
    nameNormalized: normalizeName(input.name),
    vintage: input.vintage,
    wineType: input.wineType,
    wineryId: input.wineryId,
    regionId: input.regionId,
    // 참조를 만들 수 없을 때 표시에 쓰는 이름 폴백 (참조가 있으면 화면이 참조를 우선한다)
    wineryName: input.wineryName,
    regionName: input.regionName,
    country: input.country,
    grapes: input.grapes ?? [],
    alcoholPercent: input.alcoholPercent,
    labelTags: input.labelTags ?? [],
    bottleShape: input.bottleShape,
    closure: input.closure,
    notes: input.notes,
    sourceUrls: input.sourceUrls ?? [],
    fieldConfidence: input.fieldConfidence,
    // 자유 태그는 정규화해 저장한다 (탐색 축으로 쓰이므로 표기 흔들림을 줄인다)
    tags: sanitizeTags(input.tags),
    characterNote: input.characterNote,
    // 라벨 인식 직후 자동 생성 경로에서만 초안으로 만든다
    draft: input.draft ?? false,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  await repo.putWine(wine);
  return wine;
}

/** 와인 수정 — patch 대상에 참조 필드가 있으면 존재를 재검증한다 */
export async function updateWine(
  repo: Repository,
  id: string,
  expectedRev: number,
  patch: WinePatch,
): Promise<Wine> {
  await assertRefsExist([
    refCheck('wineryId', patch.wineryId, async () => {
      if (!patch.wineryId) return true;
      return (await repo.getWinery(patch.wineryId)) !== undefined;
    }),
    refCheck('regionId', patch.regionId, async () => {
      if (!patch.regionId) return true;
      return (await repo.getRegion(patch.regionId)) !== undefined;
    }),
  ]);

  const dbPatch: Partial<Wine> = { ...patch };
  if (patch.name !== undefined) {
    dbPatch.nameNormalized = normalizeName(patch.name);
  }

  // 편집자가 한 번 확인·수정하면 초안이 아니다.
  // (명시적으로 draft 를 지정한 경우에는 그 값을 존중한다)
  if (patch.draft === undefined) {
    dbPatch.draft = false;
  }

  return repo.patchWine(id, expectedRev, dbPatch);
}

/**
 * 비어 있는 필드만 채운다 (덮어쓰지 않는다).
 *
 * 같은 와인을 다시 마셨을 때 라벨 인식·보강으로 얻은 정보를 버리지 않기 위한 경로다.
 * 기존에 값이 있는 필드는 건드리지 않으므로 편집자가 손으로 고친 값이 보존된다.
 * 초안 상태는 유지한다 — 사람이 확인한 것이 아니기 때문이다.
 */
export async function fillMissingWineFields(
  repo: Repository,
  id: string,
  input: WinePatch,
): Promise<{ wine: Wine; filled: string[] }> {
  const existing = requireFound(await repo.getWine(id), '채울 와인을 찾을 수 없습니다.');

  const patch: Partial<Wine> = {};
  const filled: string[] = [];

  const fillScalar = <
    K extends
      | 'vintage'
      | 'wineType'
      | 'country'
      | 'alcoholPercent'
      | 'bottleShape'
      | 'closure'
      | 'wineryId'
      | 'regionId'
      | 'wineryName'
      | 'regionName',
  >(
    key: K,
  ): void => {
    const value = input[key];
    if (value === undefined || existing[key] !== undefined) return;
    patch[key] = value as Wine[K];
    filled.push(key);
  };

  for (const key of [
    'vintage',
    'wineType',
    'country',
    'alcoholPercent',
    'bottleShape',
    'closure',
    'wineryName',
    'regionName',
  ] as const) {
    fillScalar(key);
  }

  // 배열 필드는 비어 있을 때만 채운다
  if (input.grapes?.length && existing.grapes.length === 0) {
    patch.grapes = input.grapes;
    filled.push('grapes');
  }
  if (input.labelTags?.length && existing.labelTags.length === 0) {
    patch.labelTags = input.labelTags;
    filled.push('labelTags');
  }
  if (input.sourceUrls?.length && existing.sourceUrls.length === 0) {
    patch.sourceUrls = input.sourceUrls;
    filled.push('sourceUrls');
  }
  if (input.tags?.length && existing.tags.length === 0) {
    patch.tags = sanitizeTags(input.tags);
    filled.push('tags');
  }
  if (input.characterNote && existing.characterNote === undefined) {
    patch.characterNote = input.characterNote;
    filled.push('characterNote');
  }

  if (filled.length === 0) return { wine: existing, filled: [] };

  // 초안 여부는 그대로 둔다 (사람이 확인한 것이 아니다)
  patch.draft = existing.draft;
  const wine = await repo.patchWine(id, existing.rev, patch);
  return { wine, filled };
}

/** 와인 삭제 — 시음 기록이 있으면 거부하고 연결 건수를 담아 에러를 던진다 */
export async function deleteWine(repo: Repository, id: string): Promise<void> {
  requireFound(await repo.getWine(id), '삭제할 와인을 찾을 수 없습니다.');

  await assertNoBackrefs('이 와인에 연결된 시음 기록이 있어 삭제할 수 없습니다.', () =>
    countTastingsForWine(repo, id),
  );

  await repo.deleteWine(id);
}

/* ── 와이너리 ──────────────────────────────────────────────────── */

export async function createWinery(repo: Repository, input: WineryInput): Promise<Winery> {
  await assertRefsExist([
    refCheck('regionId', input.regionId, async () => {
      if (!input.regionId) return true;
      return (await repo.getRegion(input.regionId)) !== undefined;
    }),
  ]);

  const now = nowIso();
  const winery: Winery = {
    id: newId(),
    type: 'WINERY',
    name: input.name,
    nameNormalized: normalizeName(input.name),
    regionId: input.regionId,
    country: input.country,
    website: input.website,
    notes: input.notes,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  await repo.putWinery(winery);
  return winery;
}

export async function updateWinery(
  repo: Repository,
  id: string,
  expectedRev: number,
  patch: WineryPatch,
): Promise<Winery> {
  await assertRefsExist([
    refCheck('regionId', patch.regionId, async () => {
      if (!patch.regionId) return true;
      return (await repo.getRegion(patch.regionId)) !== undefined;
    }),
  ]);

  const dbPatch: Partial<Winery> = { ...patch };
  if (patch.name !== undefined) {
    dbPatch.nameNormalized = normalizeName(patch.name);
  }

  return repo.patchWinery(id, expectedRev, dbPatch);
}

/** 와이너리 삭제 — 이 와이너리를 참조하는 와인이 있으면 거부한다 */
export async function deleteWinery(repo: Repository, id: string): Promise<void> {
  requireFound(await repo.getWinery(id), '삭제할 와이너리를 찾을 수 없습니다.');

  await assertNoBackrefs('이 와이너리에 연결된 와인이 있어 삭제할 수 없습니다.', () =>
    countWinesForWinery(repo, id),
  );

  await repo.deleteWinery(id);
}

/* ── 지역 ──────────────────────────────────────────────────────── */

export async function createRegion(repo: Repository, input: RegionInput): Promise<Region> {
  await assertRefsExist([
    refCheck('parentId', input.parentId, async () => {
      if (!input.parentId) return true;
      return (await repo.getRegion(input.parentId)) !== undefined;
    }),
  ]);

  const now = nowIso();
  const region: Region = {
    id: newId(),
    type: 'REGION',
    name: input.name,
    nameNormalized: normalizeName(input.name),
    level: input.level,
    parentId: input.parentId,
    country: input.country,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  await repo.putRegion(region);
  return region;
}

export async function updateRegion(
  repo: Repository,
  id: string,
  expectedRev: number,
  patch: RegionPatch,
): Promise<Region> {
  if (patch.parentId === id) {
    throw new ReferenceIntegrityError('지역은 자기 자신을 상위 지역으로 참조할 수 없습니다.', [
      { field: 'parentId', refId: id },
    ]);
  }

  await assertRefsExist([
    refCheck('parentId', patch.parentId, async () => {
      if (!patch.parentId) return true;
      return (await repo.getRegion(patch.parentId)) !== undefined;
    }),
  ]);

  const dbPatch: Partial<Region> = { ...patch };
  if (patch.name !== undefined) {
    dbPatch.nameNormalized = normalizeName(patch.name);
  }

  return repo.patchRegion(id, expectedRev, dbPatch);
}

/** 지역 삭제 — 이 지역을 참조하는 와인·와이너리·하위지역이 있으면 거부한다 */
export async function deleteRegion(repo: Repository, id: string): Promise<void> {
  requireFound(await repo.getRegion(id), '삭제할 지역을 찾을 수 없습니다.');

  await assertNoBackrefs(
    '이 지역에 연결된 와인·와이너리·하위 지역이 있어 삭제할 수 없습니다.',
    () => countRefsForRegion(repo, id),
  );

  await repo.deleteRegion(id);
}
