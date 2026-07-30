import { ReferenceIntegrityError, BackreferenceError, ConflictError } from '@/lib/db/errors';
import type { Repository } from '@/lib/db/repository';

/**
 * 참조 무결성·역참조·낙관적 동시성 관련 헬퍼.
 *
 * 관계형 DB가 강제해주던 제약(FK, 삭제 제한)을 애플리케이션 계층에서 대체한다.
 * design.md '스키마 정의와 버전' 절 참고.
 */

/** 검증할 참조 목록 — 필드명과 대상 id, 그리고 대상 존재 여부를 조회하는 함수 */
export interface RefCheck {
  /** 에러 메시지에 노출할 필드명 (예: 'wineryId') */
  field: string;
  /** 참조 대상 id */
  refId: string | undefined;
  /** 대상이 존재하는지 조회 */
  exists: () => Promise<boolean>;
}

/**
 * 참조 무결성 검증 — `wine.wineryId`/`wine.regionId`, `tasting.wineId`, `region.parentId` 등
 * 여러 참조를 한 번에 검사한다. `refId` 가 undefined 인 항목은 optional 참조로 간주해 건너뛴다.
 * 하나라도 존재하지 않으면 `ReferenceIntegrityError` 를 던진다 (모든 위반을 모아서 보고).
 */
export async function assertRefsExist(refs: RefCheck[]): Promise<void> {
  const missing: { field: string; refId: string }[] = [];

  for (const ref of refs) {
    if (ref.refId === undefined) continue;
    const exists = await ref.exists();
    if (!exists) {
      missing.push({ field: ref.field, refId: ref.refId });
    }
  }

  if (missing.length > 0) {
    const detail = missing.map((m) => `${m.field}=${m.refId}`).join(', ');
    throw new ReferenceIntegrityError(`참조 대상이 존재하지 않습니다: ${detail}`, missing);
  }
}

/**
 * 리포지토리 기반으로 흔히 쓰는 참조 존재 확인 도우미를 만든다.
 * `assertRefsExist` 와 조합해 예: `assertRefsExist([refCheck('wineryId', wine.wineryId, () => repo.getWinery(id))])`
 */
export function refCheck(
  field: string,
  refId: string | undefined,
  exists: () => Promise<boolean>,
): RefCheck {
  return { field, refId, exists };
}

/** 특정 와인을 참조하는 시음 세션 수를 계산한다 (역참조 카운트) */
export async function countTastingsForWine(repo: Repository, wineId: string): Promise<number> {
  const { items } = await repo.scanAll<unknown>();
  return items.filter((item) => isTastingReferencing(item, wineId)).length;
}

/** scanAll 결과 아이템이 특정 wineId 를 참조하는 TASTING 레코드인지 좁혀서 판별한다 */
function isTastingReferencing(item: unknown, wineId: string): boolean {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as Record<string, unknown>;
  return record['type'] === 'TASTING' && record['wineId'] === wineId;
}

/**
 * 역참조가 없어야 함을 단언한다. 역참조가 있으면 `BackreferenceError` (연결 건수 포함)를 던진다.
 * 삭제 전 가드로 사용한다 (예: 시음 기록이 있는 와인 삭제 거부).
 */
export async function assertNoBackrefs(
  message: string,
  countBackrefs: () => Promise<number>,
): Promise<void> {
  const count = await countBackrefs();
  if (count > 0) {
    throw new BackreferenceError(message, count);
  }
}

/**
 * 낙관적 동시성 patch 헬퍼 — `rev` 대조 실패 시 `ConflictError` 로 통일해 던진다.
 * 리포지토리의 `patch*` 메서드는 이미 ConditionExpression 기반으로 이 동작을 하지만,
 * 여러 patch 를 조합하는 서비스 계층에서 재사용 가능한 얇은 래퍼로 제공한다.
 */
export async function withOptimisticRev<T>(
  currentRev: number,
  run: (expectedRev: number) => Promise<T>,
): Promise<T> {
  try {
    return await run(currentRev);
  } catch (err) {
    if (err instanceof ConflictError) {
      throw err;
    }
    throw err;
  }
}
