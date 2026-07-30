import { describe, expect, it, vi } from 'vitest';
import type { Discovery, DiscoveryCandidate } from '@waganda/schemas';
import type { Repository } from '@/lib/db/repository';
import { hideDiscovery, listVisibleDiscoveries, upsertDiscovery } from '@/lib/services/discoveries';

function makeRepo(overrides: {
  listByType?: (
    type: 'WINE' | 'WINERY' | 'REGION' | 'TASTING' | 'DISCOVERY',
    order: 'asc' | 'desc',
  ) => Promise<{ items: Discovery[]; quarantined: never[] }>;
  getDiscovery?: Repository['getDiscovery'];
  putDiscovery?: Repository['putDiscovery'];
  patchDiscovery?: Repository['patchDiscovery'];
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

const baseCandidate: DiscoveryCandidate = {
  groupBy: 'grape',
  key: 'nebbiolo',
  alias: '네비올로 마니아',
  description: '네비올로 품종에서 평균보다 높은 평점을 받았습니다.',
  metric: 'meanRating',
  n: 6,
  value: 4.5,
  deltaVsOverall: 1.2,
  evidenceTastingIds: ['t1', 't2'],
};

function existingDiscovery(overrides: Partial<Discovery> = {}): Discovery {
  return {
    id: 'd1',
    type: 'DISCOVERY',
    groupBy: 'grape',
    key: 'nebbiolo',
    alias: '기존 별칭',
    description: '기존 서술',
    metric: 'meanRating',
    n: 6,
    value: 4.5,
    deltaVsOverall: 1.2,
    grade: 'strong',
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

describe('upsertDiscovery — 중복 사전 차단', () => {
  it('등급 미달(n<4 또는 delta<0.5)이면 제시하지 않는다', async () => {
    const repo = makeRepo({});
    const result = await upsertDiscovery(repo, { ...baseCandidate, n: 2, deltaVsOverall: 0.3 });
    expect(result.action).toBe('skipped_low_grade');
  });

  it('(groupBy, key) 조합이 처음이면 새로 생성한다', async () => {
    const putDiscovery = vi.fn(async () => undefined);
    const repo = makeRepo({
      listByType: async () => ({ items: [], quarantined: [] }),
      putDiscovery,
    });

    const result = await upsertDiscovery(repo, baseCandidate);

    expect(result.action).toBe('created');
    expect(result.discovery?.grade).toBe('strong');
    expect(putDiscovery).toHaveBeenCalledOnce();
  });

  it('이미 동일 (groupBy, key) 조합이 있고 표본이 늘지 않았으면 건너뛴다', async () => {
    const existing = existingDiscovery({ n: 6 });
    const repo = makeRepo({
      listByType: async () => ({ items: [existing], quarantined: [] }),
    });

    const result = await upsertDiscovery(repo, { ...baseCandidate, n: 6 });

    expect(result.action).toBe('skipped_duplicate');
  });

  it('표본(n)이 늘어난 경우에는 갱신하고 updatedFromN 을 기록한다', async () => {
    const existing = existingDiscovery({ n: 6, rev: 2 });
    const patchDiscovery = vi.fn(async () => ({ ...existing, n: 9, updatedFromN: 6 }));
    const repo = makeRepo({
      listByType: async () => ({ items: [existing], quarantined: [] }),
      patchDiscovery,
    });

    const result = await upsertDiscovery(repo, { ...baseCandidate, n: 9, deltaVsOverall: 1.5 });

    expect(result.action).toBe('updated');
    expect(patchDiscovery).toHaveBeenCalledWith(
      'd1',
      2,
      expect.objectContaining({ n: 9, updatedFromN: 6 }),
    );
  });

  it('숨긴 카드와 동일한 조합이면 재생성하지 않는다', async () => {
    const hidden = existingDiscovery({ hidden: true, n: 6 });
    const repo = makeRepo({
      listByType: async () => ({ items: [hidden], quarantined: [] }),
    });

    const result = await upsertDiscovery(repo, { ...baseCandidate, n: 6 });
    expect(result.action).toBe('skipped_duplicate');
  });
});

describe('hideDiscovery', () => {
  it('발견 카드를 숨김 처리한다', async () => {
    const patchDiscovery = vi.fn(async () => existingDiscovery({ hidden: true }));
    const repo = makeRepo({
      getDiscovery: async () => existingDiscovery(),
      patchDiscovery,
    });

    const result = await hideDiscovery(repo, 'd1', 0);

    expect(result.hidden).toBe(true);
    expect(patchDiscovery).toHaveBeenCalledWith('d1', 0, { hidden: true });
  });

  it('존재하지 않는 카드면 실패한다', async () => {
    const repo = makeRepo({ getDiscovery: async () => undefined });
    await expect(hideDiscovery(repo, 'missing', 0)).rejects.toThrow();
  });
});

describe('listVisibleDiscoveries', () => {
  it('숨긴 카드는 제외하고 반환한다', async () => {
    const repo = makeRepo({
      listByType: async () => ({
        items: [
          existingDiscovery({ id: 'd1', hidden: false }),
          existingDiscovery({ id: 'd2', hidden: true }),
        ],
        quarantined: [],
      }),
    });

    const visible = await listVisibleDiscoveries(repo);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('d1');
  });
});
