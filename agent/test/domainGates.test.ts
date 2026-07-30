import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from './helpers/inMemoryRepository.js';
import { createFakeAgent } from './helpers/fakeAgent.js';
import { makeRefreshProfileShouldRun } from '../src/graph/nodes/refreshProfile.js';
import { makeRunDiscoveryShouldRun } from '../src/graph/nodes/runDiscovery.js';
import type { StatsInputTasting } from '@app/domain/types';

function fakeTasting(id: string, tastedAt: string): StatsInputTasting {
  return { tastingId: id, tastedAt, grapes: [], labelTags: [] };
}

describe('refresh_taste_profile 조건부 노드 — 완료 시음 수가 5의 배수일 때만 실행', () => {
  it('완료 시음 수가 5의 배수가 아니면 실행하지 않는다', async () => {
    const repo = new InMemoryRepository();
    const agent = createFakeAgent([{}]);
    const shouldRun = makeRefreshProfileShouldRun({
      repo,
      agent,
      modelId: 'test-model',
      loadCompletedTastings: async () => [
        fakeTasting('t1', '2026-01-01'),
        fakeTasting('t2', '2026-01-02'),
      ],
    });
    expect(await shouldRun()).toBe(false);
  });

  it('완료 시음 수가 5의 배수(5, 10)이면 실행한다', async () => {
    const repo = new InMemoryRepository();
    const agent = createFakeAgent([{}]);
    const fiveTastings = Array.from({ length: 5 }, (_, i) => fakeTasting(`t${i}`, '2026-01-01'));
    const shouldRunFive = makeRefreshProfileShouldRun({
      repo,
      agent,
      modelId: 'test-model',
      loadCompletedTastings: async () => fiveTastings,
    });
    expect(await shouldRunFive()).toBe(true);

    const tenTastings = Array.from({ length: 10 }, (_, i) => fakeTasting(`t${i}`, '2026-01-01'));
    const shouldRunTen = makeRefreshProfileShouldRun({
      repo,
      agent,
      modelId: 'test-model',
      loadCompletedTastings: async () => tenTastings,
    });
    expect(await shouldRunTen()).toBe(true);
  });

  it('완료 시음 수가 0건이면 실행하지 않는다', async () => {
    const repo = new InMemoryRepository();
    const agent = createFakeAgent([{}]);
    const shouldRun = makeRefreshProfileShouldRun({
      repo,
      agent,
      modelId: 'test-model',
      loadCompletedTastings: async () => [],
    });
    expect(await shouldRun()).toBe(false);
  });
});

describe('run_discovery 조건부 노드 — 완료 시음 10건 미달 시 미실행', () => {
  it('완료 시음이 10건 미달이면 실행하지 않는다', async () => {
    const repo = new InMemoryRepository();
    const agent = createFakeAgent([{ candidates: [] }]);
    const shouldRun = makeRunDiscoveryShouldRun({
      repo,
      agent,
      modelId: 'test-model',
      completedTastingCount: async () => 9,
      lastDiscoveryRunCount: async () => 0,
    });
    expect(await shouldRun()).toBe(false);
  });

  it('완료 시음이 10건 이상이고 마지막 실행 이후 5건 이상 늘었으면 실행한다', async () => {
    const repo = new InMemoryRepository();
    const agent = createFakeAgent([{ candidates: [] }]);
    const shouldRun = makeRunDiscoveryShouldRun({
      repo,
      agent,
      modelId: 'test-model',
      completedTastingCount: async () => 15,
      lastDiscoveryRunCount: async () => 10,
    });
    expect(await shouldRun()).toBe(true);
  });

  it('완료 시음이 10건 이상이어도 마지막 실행 이후 5건 미달로 늘었으면 실행하지 않는다', async () => {
    const repo = new InMemoryRepository();
    const agent = createFakeAgent([{ candidates: [] }]);
    const shouldRun = makeRunDiscoveryShouldRun({
      repo,
      agent,
      modelId: 'test-model',
      completedTastingCount: async () => 12,
      lastDiscoveryRunCount: async () => 10,
    });
    expect(await shouldRun()).toBe(false);
  });
});
