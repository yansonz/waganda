/**
 * __tests__/views/read.test.ts — lib/views/read.ts 단위 테스트.
 *
 * 인메모리 Repository(InMemoryRepository)를 주입해 뷰 조합 로직을 검증한다.
 * 데이터 없는 상태(레코드 0건)에서도 예외 없이 빈 값을 반환하는지가 핵심 검증 대상이다.
 */
import { describe, expect, it } from 'vitest';
import {
  getDashboardView,
  getDiscoveriesView,
  getExploreView,
  getIncompleteTastingCaptureView,
  getRankingsView,
  getTasteProfileView,
  getTastingDetailView,
  getTimelineView,
  getWineDetailView,
  getWineListView,
  getWineryDetailView,
} from '@/lib/views/read';
import {
  InMemoryRepository,
  makeAnalysis,
  makeDiscovery,
  makeRegion,
  makeTasting,
  makeWine,
} from './testRepository';

describe('lib/views/read — 데이터 없는 상태', () => {
  it('getDashboardView 는 레코드가 없어도 빈 값으로 렌더링 가능한 뷰를 반환한다', async () => {
    const repo = new InMemoryRepository();
    const view = await getDashboardView(repo);

    expect(view.recentTastings).toEqual([]);
    expect(view.hasMoreTastings).toBe(false);
    expect(view.tasteProfile.active).toBe(false);
    expect(view.tasteProfile.progress).toBe(0);
    expect(view.recentAgreementScores).toEqual([]);
    expect(view.latestDiscoveries).toEqual([]);
    expect(view.inProgressJobs).toEqual([]);
  });

  it('getTastingDetailView 는 존재하지 않는 id 에 undefined 를 반환한다', async () => {
    const repo = new InMemoryRepository();
    const view = await getTastingDetailView(repo, 'nope');
    expect(view).toBeUndefined();
  });

  it('getWineListView 는 와인이 없으면 빈 배열을 반환한다', async () => {
    const repo = new InMemoryRepository();
    const view = await getWineListView(repo);
    expect(view).toEqual([]);
  });

  it('getExploreView 는 지역이 없으면 빈 트리를 반환한다', async () => {
    const repo = new InMemoryRepository();
    const view = await getExploreView(repo, []);
    expect(view.children).toEqual([]);
    expect(view.notFound).toBe(false);
  });

  it('getTimelineView, getRankingsView 는 시음이 없으면 빈 배열을 반환한다', async () => {
    const repo = new InMemoryRepository();
    expect(await getTimelineView(repo)).toEqual([]);
    expect(await getRankingsView(repo)).toEqual([]);
  });

  it('getDiscoveriesView 는 카드가 없으면 빈 배열을 반환한다', async () => {
    const repo = new InMemoryRepository();
    expect(await getDiscoveriesView(repo)).toEqual([]);
  });

  it('getWineDetailView, getWineryDetailView 는 존재하지 않는 id 에 undefined 를 반환한다', async () => {
    const repo = new InMemoryRepository();
    expect(await getWineDetailView(repo, 'nope')).toBeUndefined();
    expect(await getWineryDetailView(repo, 'nope')).toBeUndefined();
  });
});

describe('lib/views/read — getIncompleteTastingCaptureView', () => {
  it('음성만 있거나 와인만 있는 캡처만 이어쓰기 대상으로 반환한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(makeWine({ id: 'wine-1', name: '바롤로', vintage: 2018 }));
    const audioFirstSource = makeTasting({
      id: 'audio-first',
      wineId: 'placeholder-wine',
      tastedAt: '2025-01-01T00:00:00Z',
      lifecycle: 'collecting',
    });
    const { wineId: _unusedWineId, ...audioFirst } = audioFirstSource;
    await repo.putTasting(audioFirst);
    await repo.putRecording({
      id: 'recording-1',
      type: 'RECORDING',
      tastingId: 'audio-first',
      audioKey: 'recordings/audio-first/recording-1.webm',
      format: 'webm',
      durationSec: 20,
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    });
    await repo.putTasting(
      makeTasting({
        id: 'photo-first',
        wineId: 'wine-1',
        tastedAt: '2025-01-02T00:00:00Z',
        lifecycle: 'awaiting_audio',
      }),
    );
    await repo.putTasting(
      makeTasting({
        id: 'complete',
        wineId: 'wine-1',
        tastedAt: '2025-01-03T00:00:00Z',
        lifecycle: 'ready',
      }),
    );
    await repo.putRecording({
      id: 'recording-2',
      type: 'RECORDING',
      tastingId: 'complete',
      audioKey: 'recordings/complete/recording-2.webm',
      format: 'webm',
      durationSec: 20,
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    });

    await expect(getIncompleteTastingCaptureView(repo)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tastingId: 'audio-first', kind: 'needs_wine', recordingCount: 1 }),
        expect.objectContaining({
          tastingId: 'photo-first',
          kind: 'needs_audio',
          wine: expect.objectContaining({ wineId: 'wine-1', name: '바롤로' }),
        }),
      ]),
    );
    await expect(getIncompleteTastingCaptureView(repo)).resolves.toHaveLength(2);
  });
});

describe('lib/views/read — getDashboardView', () => {
  it('최신 시음 5건, 반응 일치도, 발견 카드, 진행 중 분석을 조합한다', async () => {
    const repo = new InMemoryRepository();
    const wine = makeWine({ id: 'w1', name: '바롤로' });
    await repo.putWine(wine);

    for (let i = 0; i < 7; i += 1) {
      const tastingId = `t${i}`;
      await repo.putTasting(
        makeTasting({ id: tastingId, wineId: 'w1', tastedAt: `2025-01-0${(i % 9) + 1}T10:00:00Z` }),
      );
      await repo.putAnalysis(makeAnalysis({ tastingId, aiRating: 4, agreementScore: 80 }));
    }
    await repo.putJob({
      type: 'JOB',
      tastingId: 't0',
      status: 'analyzing',
      completedSteps: [],
      attempts: 0,
      estimatedSec: 30,
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    });
    await repo.putDiscovery(makeDiscovery({ id: 'd1', alias: '웃음의 법칙', description: '설명' }));

    const view = await getDashboardView(repo);

    expect(view.recentTastings).toHaveLength(5);
    expect(view.hasMoreTastings).toBe(true);
    expect(view.recentAgreementScores.length).toBeGreaterThan(0);
    expect(view.latestDiscoveries).toHaveLength(1);
    expect(view.inProgressJobs).toEqual([
      expect.objectContaining({ tastingId: 't0', status: 'analyzing' }),
    ]);
  });

  it('취향 프로파일이 5건 미달이면 진행률을 함께 반환한다', async () => {
    const repo = new InMemoryRepository();
    repo.profile = {
      type: 'PROFILE',
      active: false,
      tastingCount: 3,
      progress: 0.6,
      liked: [],
      disliked: [],
      keywords: [],
      recommendations: [],
      agreementTrend: [],
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    };

    const view = await getTasteProfileView(repo);
    expect(view.active).toBe(false);
    expect(view.progress).toBe(0.6);
    expect(view.tastingCount).toBe(3);
  });
});

describe('lib/views/read — getTastingDetailView', () => {
  it('와인·와이너리·지역·과거기록·적합도를 조합한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putRegion(makeRegion({ id: 'r1', name: '피에몬테', level: 'region' }));
    await repo.putWinery({
      id: 'wy1',
      type: 'WINERY',
      name: '가야',
      nameNormalized: '가야',
      regionId: 'r1',
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    });
    const wine = makeWine({
      id: 'w1',
      name: '바롤로',
      wineryId: 'wy1',
      regionId: 'r1',
      grapes: ['Nebbiolo'],
    });
    await repo.putWine(wine);

    await repo.putTasting(
      makeTasting({ id: 'past1', wineId: 'w1', tastedAt: '2024-12-01T10:00:00Z' }),
    );
    await repo.putTasting(
      makeTasting({ id: 'current', wineId: 'w1', tastedAt: '2025-01-01T10:00:00Z' }),
    );
    await repo.putAnalysis(makeAnalysis({ tastingId: 'current', aiRating: 4.5 }));

    repo.profile = {
      type: 'PROFILE',
      active: true,
      tastingCount: 5,
      progress: 1,
      liked: [{ dimension: 'grape', key: 'Nebbiolo', n: 4, meanRating: 4.5, grade: 'solid' }],
      disliked: [],
      keywords: [],
      recommendations: [],
      agreementTrend: [],
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    };

    const view = await getTastingDetailView(repo, 'current');

    expect(view?.wine?.id).toBe('w1');
    expect(view?.winery?.name).toBe('가야');
    expect(view?.regionPath).toEqual(['피에몬테']);
    expect(view?.pastTastingsForWine).toHaveLength(1);
    expect(view?.pastTastingsForWine[0].tastingId).toBe('past1');
    expect(view?.fit).toBe('perfect');
  });
});

describe('lib/views/read — getWineListView 검색', () => {
  it('검색어와 부분일치하는 와인만 반환한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(makeWine({ id: 'w1', name: '샤블리', grapes: ['Chardonnay'] }));
    await repo.putWine(makeWine({ id: 'w2', name: '바롤로', grapes: ['Nebbiolo'] }));

    const results = await getWineListView(repo, '샤블리');
    expect(results).toHaveLength(1);
    expect(results[0].wineId).toBe('w1');
  });

  it('검색어가 없으면 전체 와인을 반환한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(makeWine({ id: 'w1', name: '샤블리' }));
    await repo.putWine(makeWine({ id: 'w2', name: '바롤로' }));

    const results = await getWineListView(repo);
    expect(results).toHaveLength(2);
  });
});

describe('lib/views/read — getWineDetailView', () => {
  it('시음 이력을 시간순으로, 평점 추이를 함께 반환한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(makeWine({ id: 'w1', name: '바롤로' }));

    await repo.putTasting(
      makeTasting({ id: 't1', wineId: 'w1', tastedAt: '2025-01-01T10:00:00Z', manualRating: 4 }),
    );
    await repo.putTasting(
      makeTasting({ id: 't2', wineId: 'w1', tastedAt: '2025-02-01T10:00:00Z' }),
    );
    await repo.putAnalysis(makeAnalysis({ tastingId: 't2', aiRating: 3.5 }));

    const view = await getWineDetailView(repo, 'w1');

    expect(view?.tastingHistory.map((t) => t.tastingId)).toEqual(['t1', 't2']);
    expect(view?.ratingTrend).toEqual([
      { tastingId: 't1', tastedAt: '2025-01-01T10:00:00Z', rating: 4, ratingSource: 'manual' },
      { tastingId: 't2', tastedAt: '2025-02-01T10:00:00Z', rating: 3.5, ratingSource: 'ai' },
    ]);
  });
});

describe('lib/views/read — getExploreView 지역 계층 탐색', () => {
  it('국가 > 지역 > 세부산지 경로를 따라 브레드크럼과 하위 노드를 계산한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putRegion(makeRegion({ id: 'kr', name: '대한민국', level: 'country' }));
    await repo.putRegion(makeRegion({ id: 'gb', name: '경북', level: 'region', parentId: 'kr' }));
    await repo.putRegion(
      makeRegion({ id: 'yc', name: '영천', level: 'subregion', parentId: 'gb' }),
    );
    await repo.putWine(makeWine({ id: 'w1', name: '영천 와인', regionId: 'yc' }));

    const rootView = await getExploreView(repo, []);
    expect(rootView.children).toHaveLength(1);
    expect(rootView.children[0].name).toBe('대한민국');

    const leafView = await getExploreView(repo, ['kr', 'gb', 'yc']);
    expect(leafView.breadcrumb.map((b) => b.name)).toEqual(['대한민국', '경북', '영천']);
    expect(leafView.winesInRegion).toHaveLength(1);
    expect(leafView.notFound).toBe(false);
  });

  it('존재하지 않는 경로는 notFound: true 를 반환한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putRegion(makeRegion({ id: 'kr', name: '대한민국', level: 'country' }));

    const view = await getExploreView(repo, ['kr', 'nope']);
    expect(view.notFound).toBe(true);
  });
});

describe('lib/views/read — getRankingsView', () => {
  it('최종 평점 기준으로 내림차순 정렬한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(makeWine({ id: 'w1', name: '와인A' }));
    await repo.putTasting(
      makeTasting({ id: 't1', wineId: 'w1', tastedAt: '2025-01-01T10:00:00Z' }),
    );
    await repo.putTasting(
      makeTasting({ id: 't2', wineId: 'w1', tastedAt: '2025-01-02T10:00:00Z' }),
    );
    await repo.putAnalysis(makeAnalysis({ tastingId: 't1', aiRating: 3 }));
    await repo.putAnalysis(makeAnalysis({ tastingId: 't2', aiRating: 4.5 }));

    const view = await getRankingsView(repo);
    expect(view.map((v) => v.tastingId)).toEqual(['t2', 't1']);
    expect(view.map((v) => v.ratingSource)).toEqual(['ai', 'ai']);
  });

  it('수동 평점이 있으면 AI 평점 대신 그것으로 줄을 세운다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(makeWine({ id: 'w1', name: '와인A' }));
    // t1: AI 3점을 수동 5점으로 덮어씀 → 1위
    await repo.putTasting(
      makeTasting({ id: 't1', wineId: 'w1', tastedAt: '2025-01-01T10:00:00Z', manualRating: 5 }),
    );
    await repo.putTasting(
      makeTasting({ id: 't2', wineId: 'w1', tastedAt: '2025-01-02T10:00:00Z' }),
    );
    await repo.putAnalysis(makeAnalysis({ tastingId: 't1', aiRating: 3 }));
    await repo.putAnalysis(makeAnalysis({ tastingId: 't2', aiRating: 4.5 }));

    const view = await getRankingsView(repo);
    expect(view.map((v) => [v.tastingId, v.rating, v.ratingSource])).toEqual([
      ['t1', 5, 'manual'],
      ['t2', 4.5, 'ai'],
    ]);
  });

  it('AI 평점도 수동 평점도 없는 시음은 랭킹에서 제외한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(makeWine({ id: 'w1', name: '와인A' }));
    await repo.putTasting(
      makeTasting({ id: 't1', wineId: 'w1', tastedAt: '2025-01-01T10:00:00Z', manualRating: 4 }),
    );
    // 무음 녹음 등으로 평점이 없는 기록 (R5)
    await repo.putTasting(
      makeTasting({ id: 't2', wineId: 'w1', tastedAt: '2025-01-02T10:00:00Z' }),
    );

    const view = await getRankingsView(repo);
    expect(view).toHaveLength(1);
    expect(view[0].tastingId).toBe('t1');
  });
});

describe('lib/views/read — getDiscoveriesView', () => {
  it('숨긴 카드는 제외하고 최신순으로 반환한다', async () => {
    const repo = new InMemoryRepository();
    await repo.putDiscovery(
      makeDiscovery({ id: 'd1', alias: 'A', description: 'A', createdAt: '2025-01-01T00:00:00Z' }),
    );
    await repo.putDiscovery(
      makeDiscovery({
        id: 'd2',
        alias: 'B',
        description: 'B',
        createdAt: '2025-02-01T00:00:00Z',
        hidden: true,
      }),
    );
    await repo.putDiscovery(
      makeDiscovery({ id: 'd3', alias: 'C', description: 'C', createdAt: '2025-03-01T00:00:00Z' }),
    );

    const view = await getDiscoveriesView(repo);
    expect(view.map((d) => d.id)).toEqual(['d3', 'd1']);
  });
});
