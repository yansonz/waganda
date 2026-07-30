/**
 * lib/services/discoveries.ts — 발견 카드 서비스 (13.4).
 *
 * - 중복 사전 차단: `(groupBy, key)` 조합으로 이미 존재하는 카드는 새로 만들지 않는다.
 * - 표본 증가 시 갱신: 기존 카드보다 표본(n)이 늘었으면 갱신하고 `updatedFromN` 을 기록한다.
 * - 숨김 처리: 편집자가 숨긴 카드는 재제시하지 않는다 (lib/domain/discovery.ts 의 isDuplicate 활용).
 */
import { randomUUID } from 'node:crypto';
import { CURRENT_SCHEMA_VERSION, type Discovery, type DiscoveryCandidate } from '@waganda/schemas';
import { gradeDiscovery, isDuplicate, type ExistingDiscoveryKey } from '@/lib/domain/discovery';
import type { Repository } from '@/lib/db/repository';
import { requireFound } from '@/lib/db/repository';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID();
}

export interface UpsertDiscoveryResult {
  /** 새로 생성했는지, 갱신했는지, 등급 미달로 제시하지 않았는지 */
  action: 'created' | 'updated' | 'skipped_duplicate' | 'skipped_low_grade';
  discovery?: Discovery;
}

/**
 * 발견 후보를 등급 판정 후 저장한다.
 *
 * 흐름:
 * 1. `gradeDiscovery` 로 등급을 판정한다. null 이면 제시하지 않는다.
 * 2. 기존 카드 목록에서 `(groupBy, key)` 중복을 확인한다.
 *    - 중복이 없으면 새 카드를 생성한다.
 *    - 중복이 있고 표본(n)이 늘었으면 갱신한다 (`updatedFromN` 기록).
 *    - 중복이 있고 표본이 늘지 않았으면(숨김 여부 무관) 건너뛴다.
 */
export async function upsertDiscovery(
  repo: Repository,
  candidate: DiscoveryCandidate,
  promptVersion?: string,
  modelId?: string,
): Promise<UpsertDiscoveryResult> {
  const grade = gradeDiscovery({ n: candidate.n, deltaVsOverall: candidate.deltaVsOverall });
  if (grade === null) {
    return { action: 'skipped_low_grade' };
  }

  const { items: existingDiscoveries } = await repo.listByType<Discovery>('DISCOVERY', 'desc');
  const existingKeys: ExistingDiscoveryKey[] = existingDiscoveries.map((d) => ({
    groupBy: d.groupBy,
    key: d.key,
    hidden: d.hidden,
  }));

  const duplicate = existingDiscoveries.find(
    (d) => d.groupBy === candidate.groupBy && d.key === candidate.key,
  );

  if (!duplicate) {
    if (!isDuplicate(candidate.groupBy, candidate.key, existingKeys)) {
      const now = nowIso();
      const discovery: Discovery = {
        id: newId(),
        type: 'DISCOVERY',
        groupBy: candidate.groupBy,
        key: candidate.key,
        alias: candidate.alias,
        description: candidate.description,
        metric: candidate.metric,
        n: candidate.n,
        value: candidate.value,
        deltaVsOverall: candidate.deltaVsOverall,
        grade,
        evidenceTastingIds: candidate.evidenceTastingIds,
        disclaimer: '표본이 적어 우연일 수 있습니다. 기록이 쌓이면 다시 판정합니다.',
        hidden: false,
        promptVersion,
        modelId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };
      await repo.putDiscovery(discovery);
      return { action: 'created', discovery };
    }
    // 이론상 도달하지 않음(위의 find 와 isDuplicate 가 동일 조건) — 안전망으로 유지
    return { action: 'skipped_duplicate' };
  }

  // 표본이 늘어난 경우에만 갱신한다 (design.md '발견 카드 판정')
  if (candidate.n > duplicate.n) {
    const discovery = await repo.patchDiscovery(duplicate.id, duplicate.rev, {
      alias: candidate.alias,
      description: candidate.description,
      n: candidate.n,
      value: candidate.value,
      deltaVsOverall: candidate.deltaVsOverall,
      grade,
      evidenceTastingIds: candidate.evidenceTastingIds,
      updatedFromN: duplicate.n,
    });
    return { action: 'updated', discovery };
  }

  return { action: 'skipped_duplicate', discovery: duplicate };
}

/** 발견 카드 숨김 처리 (13.5) */
export async function hideDiscovery(
  repo: Repository,
  id: string,
  expectedRev: number,
): Promise<Discovery> {
  requireFound(await repo.getDiscovery(id), '숨길 발견 카드를 찾을 수 없습니다.');
  return repo.patchDiscovery(id, expectedRev, { hidden: true });
}

/** 숨김 제외 발견 카드 목록 조회 */
export async function listVisibleDiscoveries(repo: Repository): Promise<Discovery[]> {
  const { items } = await repo.listByType<Discovery>('DISCOVERY', 'desc');
  return items.filter((d) => !d.hidden);
}
