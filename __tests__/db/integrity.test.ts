import { describe, expect, it, vi } from 'vitest';
import {
  assertNoBackrefs,
  assertRefsExist,
  countTastingsForWine,
  refCheck,
  withOptimisticRev,
} from '@/lib/db/integrity';
import { ReferenceIntegrityError, BackreferenceError, ConflictError } from '@/lib/db/errors';
import type { Repository } from '@/lib/db/repository';

describe('assertRefsExist — 참조 무결성', () => {
  it('모든 참조가 존재하면 통과한다', async () => {
    await expect(
      assertRefsExist([
        refCheck('wineryId', 'wy1', async () => true),
        refCheck('regionId', 'r1', async () => true),
      ]),
    ).resolves.toBeUndefined();
  });

  it('참조 대상이 없으면(undefined) 검사를 건너뛴다 (optional 참조)', async () => {
    const existsSpy = vi.fn(async () => true);
    await expect(
      assertRefsExist([refCheck('wineryId', undefined, existsSpy)]),
    ).resolves.toBeUndefined();
    expect(existsSpy).not.toHaveBeenCalled();
  });

  it('존재하지 않는 참조가 있으면 ReferenceIntegrityError 를 던진다', async () => {
    await expect(
      assertRefsExist([refCheck('wineryId', 'wy-missing', async () => false)]),
    ).rejects.toThrow(ReferenceIntegrityError);
  });

  it('ReferenceIntegrityError 는 누락된 참조 목록을 포함한다', async () => {
    try {
      await assertRefsExist([
        refCheck('wineryId', 'wy-missing', async () => false),
        refCheck('regionId', 'r-missing', async () => false),
      ]);
      expect.fail('예외가 던져져야 한다');
    } catch (err) {
      expect(err).toBeInstanceOf(ReferenceIntegrityError);
      const error = err as ReferenceIntegrityError;
      expect(error.missingRefs).toEqual([
        { field: 'wineryId', refId: 'wy-missing' },
        { field: 'regionId', refId: 'r-missing' },
      ]);
      expect(error.status).toBe(400);
      expect(error.code).toBe('REFERENCE_INTEGRITY');
    }
  });

  it('wine.wineryId, wine.regionId, tasting.wineId, region.parentId 조합 시나리오', async () => {
    // wine.regionId 만 존재하지 않는 상황을 재현
    await expect(
      assertRefsExist([
        refCheck('wineryId', 'wy1', async () => true),
        refCheck('regionId', 'r-missing', async () => false),
      ]),
    ).rejects.toThrow(/참조 대상이 존재하지 않습니다/);
  });
});

describe('countTastingsForWine — 역참조 카운트', () => {
  function makeRepoWithScan(items: unknown[]): Repository {
    return {
      scanAll: vi.fn(async () => ({ items, quarantined: [] })),
    } as unknown as Repository;
  }

  it('해당 wineId 를 참조하는 TASTING 레코드 수를 반환한다', async () => {
    const repo = makeRepoWithScan([
      { type: 'TASTING', wineId: 'w1' },
      { type: 'TASTING', wineId: 'w1' },
      { type: 'TASTING', wineId: 'w2' },
      { type: 'WINE', id: 'w1' },
    ]);

    const count = await countTastingsForWine(repo, 'w1');
    expect(count).toBe(2);
  });

  it('참조가 없으면 0을 반환한다', async () => {
    const repo = makeRepoWithScan([{ type: 'TASTING', wineId: 'w2' }]);
    const count = await countTastingsForWine(repo, 'w1');
    expect(count).toBe(0);
  });
});

describe('assertNoBackrefs — 역참조 있는 삭제 거부', () => {
  it('역참조가 없으면 통과한다', async () => {
    await expect(assertNoBackrefs('삭제 불가', async () => 0)).resolves.toBeUndefined();
  });

  it('역참조가 있으면 BackreferenceError(count 포함) 를 던진다', async () => {
    try {
      await assertNoBackrefs('시음 기록이 있는 와인은 삭제할 수 없습니다', async () => 3);
      expect.fail('예외가 던져져야 한다');
    } catch (err) {
      expect(err).toBeInstanceOf(BackreferenceError);
      const error = err as BackreferenceError;
      expect(error.count).toBe(3);
      expect(error.status).toBe(409);
      expect(error.code).toBe('BACKREFERENCE_EXISTS');
      expect(error.message).toBe('시음 기록이 있는 와인은 삭제할 수 없습니다');
    }
  });
});

describe('withOptimisticRev — rev 충돌 시 오류', () => {
  it('정상 처리 시 결과를 그대로 반환한다', async () => {
    const result = await withOptimisticRev(0, async (rev) => ({ rev, ok: true }));
    expect(result).toEqual({ rev: 0, ok: true });
  });

  it('ConflictError 가 발생하면 그대로 전파한다', async () => {
    await expect(
      withOptimisticRev(0, async () => {
        throw new ConflictError();
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('다른 종류의 에러도 전파한다', async () => {
    await expect(
      withOptimisticRev(0, async () => {
        throw new Error('unexpected');
      }),
    ).rejects.toThrow('unexpected');
  });
});
