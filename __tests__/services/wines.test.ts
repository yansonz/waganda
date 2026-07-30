import { describe, expect, it, vi } from 'vitest';
import type { Region, Wine, Winery } from '@waganda/schemas';
import type { Repository } from '@/lib/db/repository';
import { ReferenceIntegrityError, BackreferenceError } from '@/lib/db/errors';
import {
  createRegion,
  createWine,
  createWinery,
  deleteRegion,
  deleteWine,
  deleteWinery,
  findDuplicateCandidates,
  updateRegion,
  updateWine,
  updateWinery,
} from '@/lib/services/wines';

/** 테스트용 인메모리 Repository — 필요한 메서드만 구현하고 나머지는 사용 시 예외를 던진다 */
function makeRepo(overrides: {
  getWine?: Repository['getWine'];
  putWine?: Repository['putWine'];
  patchWine?: Repository['patchWine'];
  deleteWine?: Repository['deleteWine'];
  getWinery?: Repository['getWinery'];
  putWinery?: Repository['putWinery'];
  patchWinery?: Repository['patchWinery'];
  deleteWinery?: Repository['deleteWinery'];
  getRegion?: Repository['getRegion'];
  putRegion?: Repository['putRegion'];
  patchRegion?: Repository['patchRegion'];
  deleteRegion?: Repository['deleteRegion'];
  scanAll?: () => Promise<{ items: Record<string, unknown>[]; quarantined: never[] }>;
  listByType?: (
    type: 'WINE' | 'WINERY' | 'REGION' | 'TASTING' | 'DISCOVERY',
    order: 'asc' | 'desc',
  ) => Promise<{ items: Wine[]; quarantined: never[] }>;
}): Repository {
  const notImplemented = (name: string) => async () => {
    throw new Error(`Repository.${name} 은 이 테스트에서 스텁되지 않았습니다.`);
  };

  return {
    getWine: notImplemented('getWine'),
    putWine: notImplemented('putWine'),
    patchWine: notImplemented('patchWine'),
    deleteWine: notImplemented('deleteWine'),
    getWinery: notImplemented('getWinery'),
    putWinery: notImplemented('putWinery'),
    patchWinery: notImplemented('patchWinery'),
    deleteWinery: notImplemented('deleteWinery'),
    getRegion: notImplemented('getRegion'),
    putRegion: notImplemented('putRegion'),
    patchRegion: notImplemented('patchRegion'),
    deleteRegion: notImplemented('deleteRegion'),
    getTasting: notImplemented('getTasting'),
    putTasting: notImplemented('putTasting'),
    patchTasting: notImplemented('patchTasting'),
    deleteTasting: notImplemented('deleteTasting'),
    getRecording: notImplemented('getRecording'),
    putRecording: notImplemented('putRecording'),
    patchRecording: notImplemented('patchRecording'),
    deleteRecording: notImplemented('deleteRecording'),
    getAnalysis: notImplemented('getAnalysis'),
    putAnalysis: notImplemented('putAnalysis'),
    patchAnalysis: notImplemented('patchAnalysis'),
    deleteAnalysis: notImplemented('deleteAnalysis'),
    getJob: notImplemented('getJob'),
    putJob: notImplemented('putJob'),
    patchJob: notImplemented('patchJob'),
    deleteJob: notImplemented('deleteJob'),
    getProfile: notImplemented('getProfile'),
    putProfile: notImplemented('putProfile'),
    patchProfile: notImplemented('patchProfile'),
    getDiscovery: notImplemented('getDiscovery'),
    putDiscovery: notImplemented('putDiscovery'),
    patchDiscovery: notImplemented('patchDiscovery'),
    deleteDiscovery: notImplemented('deleteDiscovery'),
    queryTastingBundle: notImplemented('queryTastingBundle'),
    listByType: notImplemented('listByType'),
    scanAll: notImplemented('scanAll'),
    ...overrides,
  } as unknown as Repository;
}

const baseWine: Wine = {
  id: 'w1',
  type: 'WINE',
  name: 'Barolo 2018',
  nameNormalized: 'barolo 2018',
  wineryId: 'wy1',
  grapes: ['Nebbiolo'],
  labelTags: [],
  sourceUrls: [],
    draft: false,
    tags: [],
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

const baseWinery: Winery = {
  id: 'wy1',
  type: 'WINERY',
  name: '테스트 와이너리',
  nameNormalized: '테스트 와이너리',
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

const baseRegion: Region = {
  id: 'r1',
  type: 'REGION',
  name: '피에몬테',
  nameNormalized: '피에몬테',
  level: 'region',
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

describe('createWine — 참조 무결성', () => {
  it('존재하지 않는 wineryId 참조 시 거부한다', async () => {
    const repo = makeRepo({ getWinery: async () => undefined });

    await expect(createWine(repo, { name: '새 와인', wineryId: 'missing-winery' })).rejects.toThrow(
      ReferenceIntegrityError,
    );
  });

  it('존재하지 않는 regionId 참조 시 거부한다', async () => {
    const repo = makeRepo({ getRegion: async () => undefined });

    await expect(createWine(repo, { name: '새 와인', regionId: 'missing-region' })).rejects.toThrow(
      ReferenceIntegrityError,
    );
  });

  it('참조가 모두 유효하면 와인을 생성한다', async () => {
    const putWine = vi.fn(async () => undefined);
    const repo = makeRepo({
      getWinery: async () => baseWinery,
      getRegion: async () => baseRegion,
      putWine,
    });

    const wine = await createWine(repo, { name: '새 와인', wineryId: 'wy1', regionId: 'r1' });

    expect(wine.name).toBe('새 와인');
    expect(wine.nameNormalized).toBe('새 와인');
    expect(putWine).toHaveBeenCalledOnce();
  });

  it('참조 필드가 없으면(optional) 검증을 건너뛰고 생성한다', async () => {
    const putWine = vi.fn(async () => undefined);
    const repo = makeRepo({ putWine });

    const wine = await createWine(repo, { name: '단순 와인' });
    expect(wine.wineryId).toBeUndefined();
    expect(putWine).toHaveBeenCalledOnce();
  });
});

describe('updateWine', () => {
  it('patch 에 새 wineryId 가 있으면 존재를 재검증한다', async () => {
    const repo = makeRepo({ getWinery: async () => undefined });

    await expect(updateWine(repo, 'w1', 0, { wineryId: 'missing' })).rejects.toThrow(
      ReferenceIntegrityError,
    );
  });

  it('name patch 시 nameNormalized 도 함께 갱신한다', async () => {
    const patchWine = vi.fn(async () => ({ ...baseWine, name: '변경됨' }));
    const repo = makeRepo({ patchWine });

    await updateWine(repo, 'w1', 0, { name: '변경됨' });

    expect(patchWine).toHaveBeenCalledWith(
      'w1',
      0,
      expect.objectContaining({ name: '변경됨', nameNormalized: '변경됨' }),
    );
  });
});

describe('deleteWine — 역참조 검증', () => {
  it('시음 기록이 있으면 거부하고 연결 건수를 포함한다', async () => {
    const repo = makeRepo({
      getWine: async () => baseWine,
      scanAll: async () => ({
        items: [
          { type: 'TASTING', wineId: 'w1' },
          { type: 'TASTING', wineId: 'w1' },
        ],
        quarantined: [],
      }),
    });

    try {
      await deleteWine(repo, 'w1');
      expect.fail('예외가 던져져야 한다');
    } catch (err) {
      expect(err).toBeInstanceOf(BackreferenceError);
      expect((err as BackreferenceError).count).toBe(2);
    }
  });

  it('시음 기록이 없으면 삭제한다', async () => {
    const deleteWineFn = vi.fn(async () => undefined);
    const repo = makeRepo({
      getWine: async () => baseWine,
      scanAll: async () => ({ items: [], quarantined: [] }),
      deleteWine: deleteWineFn,
    });

    await deleteWine(repo, 'w1');
    expect(deleteWineFn).toHaveBeenCalledWith('w1');
  });
});

describe('findDuplicateCandidates — 이름+빈티지+와이너리', () => {
  it('이름이 일치하는 와인을 후보로 반환한다', async () => {
    const repo = makeRepo({
      listByType: async () => ({ items: [baseWine], quarantined: [] }),
      getWinery: async () => baseWinery,
      scanAll: async () => ({ items: [], quarantined: [] }),
    });

    const candidates = await findDuplicateCandidates(repo, { name: 'Barolo 2018' });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].wineId).toBe('w1');
    expect(candidates[0].matchedOn).toContain('name');
  });

  it('빈티지·와이너리까지 일치하면 matchedOn 에 모두 포함된다', async () => {
    const wineWithVintage: Wine = { ...baseWine, vintage: 2018 };
    const repo = makeRepo({
      listByType: async () => ({ items: [wineWithVintage], quarantined: [] }),
      getWinery: async () => baseWinery,
      scanAll: async () => ({ items: [], quarantined: [] }),
    });

    const candidates = await findDuplicateCandidates(repo, {
      name: 'Barolo 2018',
      vintage: 2018,
      wineryId: 'wy1',
    });

    expect(candidates[0].matchedOn).toEqual(['name', 'vintage', 'winery']);
  });

  it('이름이 다르면 후보에 포함되지 않는다', async () => {
    const repo = makeRepo({
      listByType: async () => ({ items: [baseWine], quarantined: [] }),
    });

    const candidates = await findDuplicateCandidates(repo, { name: '전혀 다른 와인' });
    expect(candidates).toHaveLength(0);
  });
});

describe('지역 — 자기 참조 및 삭제 방지', () => {
  it('지역이 자기 자신을 parentId 로 참조하면 거부한다', async () => {
    await expect(updateRegion(makeRepo({}), 'r1', 0, { parentId: 'r1' })).rejects.toThrow(
      ReferenceIntegrityError,
    );
  });

  it('하위 참조가 있는 지역 삭제는 거부한다', async () => {
    const repo = makeRepo({
      getRegion: async () => baseRegion,
      scanAll: async () => ({
        items: [{ type: 'WINERY', regionId: 'r1' }],
        quarantined: [],
      }),
    });

    await expect(deleteRegion(repo, 'r1')).rejects.toThrow(BackreferenceError);
  });
});

describe('와이너리 — 삭제 방지', () => {
  it('name patch 시 nameNormalized 도 함께 갱신한다', async () => {
    const patchWinery = vi.fn(async () => ({ ...baseWinery, name: '변경된 와이너리' }));
    const repo = makeRepo({ patchWinery });

    await updateWinery(repo, 'wy1', 0, { name: '변경된 와이너리' });

    expect(patchWinery).toHaveBeenCalledWith(
      'wy1',
      0,
      expect.objectContaining({ name: '변경된 와이너리', nameNormalized: '변경된 와이너리' }),
    );
  });

  it('연결된 와인이 있는 와이너리 삭제는 거부한다', async () => {
    const repo = makeRepo({
      getWinery: async () => baseWinery,
      scanAll: async () => ({
        items: [{ type: 'WINE', wineryId: 'wy1' }],
        quarantined: [],
      }),
    });

    await expect(deleteWinery(repo, 'wy1')).rejects.toThrow(BackreferenceError);
  });

  it('참조가 없으면 와이너리를 삭제한다', async () => {
    const deleteWineryFn = vi.fn(async () => undefined);
    const repo = makeRepo({
      getWinery: async () => baseWinery,
      scanAll: async () => ({ items: [], quarantined: [] }),
      deleteWinery: deleteWineryFn,
    });

    await deleteWinery(repo, 'wy1');
    expect(deleteWineryFn).toHaveBeenCalledWith('wy1');
  });

  it('존재하지 않는 regionId 참조 시 와이너리 생성을 거부한다', async () => {
    const repo = makeRepo({ getRegion: async () => undefined });
    await expect(createWinery(repo, { name: '새 와이너리', regionId: 'missing' })).rejects.toThrow(
      ReferenceIntegrityError,
    );
  });

  it('존재하지 않는 parentId 참조 시 지역 생성을 거부한다', async () => {
    const repo = makeRepo({ getRegion: async () => undefined });
    await expect(
      createRegion(repo, { name: '하위지역', level: 'subregion', parentId: 'missing' }),
    ).rejects.toThrow(ReferenceIntegrityError);
  });
});
