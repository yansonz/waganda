/**
 * lib/domain/stats.ts 테스트 — computeStats 12개 groupBy 축, minSampleSize, 메트릭, 빈 데이터
 */
import { describe, expect, it } from 'vitest';
import type { ComputeStatsSpec } from '@waganda/schemas';
import { computeStats } from '@/lib/domain/stats';
import type { StatsInputTasting } from '@/lib/domain/types';

/** 테스트용 기본 시음 뷰 생성 헬퍼 */
function makeTasting(
  overrides: Partial<StatsInputTasting> & { tastingId: string },
): StatsInputTasting {
  return {
    tastedAt: '2024-01-15T19:00:00+09:00',
    grapes: [],
    labelTags: [],
    ...overrides,
  };
}

describe('computeStats', () => {
  it('빈 데이터를 넘기면 groups 빈 배열, overall 0, totalN 0', () => {
    const spec: ComputeStatsSpec = { groupBy: 'country', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats([], spec);

    expect(result.groups).toEqual([]);
    expect(result.overall).toBe(0);
    expect(result.totalN).toBe(0);
  });

  it('단일 그룹만 minSampleSize 이상이면 해당 그룹만 반환', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'France', manualRating: 4 }),
      makeTasting({ tastingId: 't2', country: 'France', manualRating: 5 }),
      makeTasting({ tastingId: 't3', country: 'France', manualRating: 4 }),
      makeTasting({ tastingId: 't4', country: 'France', manualRating: 4 }),
      makeTasting({ tastingId: 't5', country: 'Italy', manualRating: 3 }), // 표본 1건 → 제외
    ];
    const spec: ComputeStatsSpec = { groupBy: 'country', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe('France');
    expect(result.groups[0].n).toBe(4);
  });

  it('minSampleSize 미달 그룹은 결과에서 제외된다', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'Spain', manualRating: 4 }),
      makeTasting({ tastingId: 't2', country: 'Spain', manualRating: 4 }),
    ];
    const spec: ComputeStatsSpec = { groupBy: 'country', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);

    expect(result.groups).toHaveLength(0);
    expect(result.totalN).toBe(2); // overall 계산에는 포함
  });

  it('grape 축은 다중값 — 한 시음이 여러 그룹에 기여한다', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', grapes: ['Pinot Noir', 'Merlot'], manualRating: 5 }),
      makeTasting({ tastingId: 't2', grapes: ['Pinot Noir'], manualRating: 4 }),
      makeTasting({ tastingId: 't3', grapes: ['Pinot Noir'], manualRating: 4 }),
      makeTasting({ tastingId: 't4', grapes: ['Merlot'], manualRating: 3 }),
      makeTasting({ tastingId: 't5', grapes: ['Merlot'], manualRating: 3 }),
    ];
    const spec: ComputeStatsSpec = { groupBy: 'grape', metric: 'meanRating', minSampleSize: 3 };
    const result = computeStats(tastings, spec);

    const pinot = result.groups.find((g) => g.key === 'Pinot Noir');
    const merlot = result.groups.find((g) => g.key === 'Merlot');
    expect(pinot?.n).toBe(3); // t1, t2, t3
    expect(merlot?.n).toBe(3); // t1, t4, t5
  });

  it('labelTag 축도 다중값 — 한 시음이 여러 태그 그룹에 기여한다', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', labelTags: ['animal', 'minimal'], manualRating: 5 }),
      makeTasting({ tastingId: 't2', labelTags: ['animal'], manualRating: 4 }),
      makeTasting({ tastingId: 't3', labelTags: ['animal'], manualRating: 4 }),
      makeTasting({ tastingId: 't4', labelTags: ['minimal'], manualRating: 3 }),
      makeTasting({ tastingId: 't5', labelTags: ['minimal'], manualRating: 3 }),
    ];
    const spec: ComputeStatsSpec = { groupBy: 'labelTag', metric: 'meanRating', minSampleSize: 3 };
    const result = computeStats(tastings, spec);

    const animal = result.groups.find((g) => g.key === 'animal');
    const minimal = result.groups.find((g) => g.key === 'minimal');
    expect(animal?.n).toBe(3);
    expect(minimal?.n).toBe(3);
  });

  it('region 축 — regionName 기준 그룹핑', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, regionName: 'Chablis', manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = { groupBy: 'region', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('Chablis');
    expect(result.groups[0].n).toBe(4);
  });

  it('priceBand 축', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, priceBand: '20k_50k', manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = { groupBy: 'priceBand', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('20k_50k');
  });

  it('vintageDecade 축 — 빈티지 연도에서 연대 파생', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, vintage: 2018, manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = {
      groupBy: 'vintageDecade',
      metric: 'meanRating',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('2010s');
  });

  it('bottleShape 축', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, bottleShape: 'burgundy', manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = {
      groupBy: 'bottleShape',
      metric: 'meanRating',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('burgundy');
  });

  it('closure 축', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, closure: 'screwcap', manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = { groupBy: 'closure', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('screwcap');
  });

  it('weekday 축 — tastedAt 에서 요일 파생 (월요일 2024-01-15)', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, tastedAt: '2024-01-15T19:00:00+09:00', manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = { groupBy: 'weekday', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);
    // 서비스 시간대(Asia/Seoul) 기준 2024-01-15 는 월요일이므로 1 — 실행 환경과 무관하게 고정
    expect(result.groups[0].key).toBe('1');
  });

  it('hourBucket 축 — tastedAt 에서 시간대 파생', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, tastedAt: '2024-01-15T19:30:00+09:00', manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = {
      groupBy: 'hourBucket',
      metric: 'meanRating',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('evening');
  });

  it('daysSincePrevTasting 축', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, daysSincePrevTasting: 7, manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = {
      groupBy: 'daysSincePrevTasting',
      metric: 'meanRating',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('7');
  });

  it('hadLaughter 축', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, hadLaughter: true, manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = {
      groupBy: 'hadLaughter',
      metric: 'meanRating',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('true');
  });

  it('speakerAgreementBand 축 — agreementScore 에서 밴드 파생', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, agreementScore: 90, manualRating: 4 }),
    );
    const spec: ComputeStatsSpec = {
      groupBy: 'speakerAgreementBand',
      metric: 'meanRating',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].key).toBe('high');
  });

  it('ratioAtOrAbove4 메트릭 — 4점 이상 비율 계산', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'France', manualRating: 5 }),
      makeTasting({ tastingId: 't2', country: 'France', manualRating: 4 }),
      makeTasting({ tastingId: 't3', country: 'France', manualRating: 3 }),
      makeTasting({ tastingId: 't4', country: 'France', manualRating: 2 }),
    ];
    const spec: ComputeStatsSpec = {
      groupBy: 'country',
      metric: 'ratioAtOrAbove4',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].value).toBeCloseTo(0.5, 5); // 4건 중 2건이 4점 이상
  });

  it('meanNoteAxis 메트릭 — noteAxis 지정 필드의 평균', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'France', notes: { acidity: 4 } }),
      makeTasting({ tastingId: 't2', country: 'France', notes: { acidity: 3 } }),
      makeTasting({ tastingId: 't3', country: 'France', notes: { acidity: 5 } }),
      makeTasting({ tastingId: 't4', country: 'France', notes: { acidity: 4 } }),
    ];
    const spec: ComputeStatsSpec = {
      groupBy: 'country',
      metric: 'meanNoteAxis',
      noteAxis: 'acidity',
      minSampleSize: 4,
    };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].value).toBeCloseTo(4, 5); // (4+3+5+4)/4
  });

  it('meanRating — 수동 평점이 있으면 AI 평점보다 우선한다', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'France', manualRating: 5, aiRating: 2 }),
      makeTasting({ tastingId: 't2', country: 'France', manualRating: 5, aiRating: 2 }),
      makeTasting({ tastingId: 't3', country: 'France', manualRating: 5, aiRating: 2 }),
      makeTasting({ tastingId: 't4', country: 'France', manualRating: 5, aiRating: 2 }),
    ];
    const spec: ComputeStatsSpec = { groupBy: 'country', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].value).toBe(5); // AI 평점(2)이 아니라 수동 평점(5) 사용
  });

  it('meanRating — 수동 평점이 없으면 AI 평점을 사용한다', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'France', aiRating: 3 }),
      makeTasting({ tastingId: 't2', country: 'France', aiRating: 3 }),
      makeTasting({ tastingId: 't3', country: 'France', aiRating: 3 }),
      makeTasting({ tastingId: 't4', country: 'France', aiRating: 3 }),
    ];
    const spec: ComputeStatsSpec = { groupBy: 'country', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);
    expect(result.groups[0].value).toBe(3);
  });

  it('deltaVsOverall 산출 — 그룹 값에서 전체 평균을 뺀 값', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'France', manualRating: 5 }),
      makeTasting({ tastingId: 't2', country: 'France', manualRating: 5 }),
      makeTasting({ tastingId: 't3', country: 'France', manualRating: 5 }),
      makeTasting({ tastingId: 't4', country: 'France', manualRating: 5 }),
      makeTasting({ tastingId: 't5', country: 'Italy', manualRating: 1 }),
      makeTasting({ tastingId: 't6', country: 'Italy', manualRating: 1 }),
      makeTasting({ tastingId: 't7', country: 'Italy', manualRating: 1 }),
      makeTasting({ tastingId: 't8', country: 'Italy', manualRating: 1 }),
    ];
    const spec: ComputeStatsSpec = { groupBy: 'country', metric: 'meanRating', minSampleSize: 4 };
    const result = computeStats(tastings, spec);

    // overall = (5*4 + 1*4)/8 = 3
    expect(result.overall).toBe(3);
    const france = result.groups.find((g) => g.key === 'France');
    const italy = result.groups.find((g) => g.key === 'Italy');
    expect(france?.deltaVsOverall).toBe(2);
    expect(italy?.deltaVsOverall).toBe(-2);
  });

  it('메트릭 계산에 필요한 값이 없는 시음은 그룹·overall 계산에서 제외된다', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', country: 'France' }), // 평점 없음
      makeTasting({ tastingId: 't2', country: 'France', manualRating: 4 }),
    ];
    const spec: ComputeStatsSpec = { groupBy: 'country', metric: 'meanRating', minSampleSize: 1 };
    const result = computeStats(tastings, spec);
    expect(result.totalN).toBe(1);
    expect(result.groups[0].n).toBe(1);
  });
});
