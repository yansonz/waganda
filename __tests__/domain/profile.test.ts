/**
 * lib/domain/profile.ts 테스트 — 취향 프로파일 5건 경계, 선호/비선호 판정, 적합도
 */
import { describe, expect, it } from 'vitest';
import { assessFit, buildTasteProfile, shouldRefreshProfile } from '@/lib/domain/profile';
import type { StatsInputTasting } from '@/lib/domain/types';

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

describe('buildTasteProfile', () => {
  it('빈 데이터 — active false, progress 0', () => {
    const profile = buildTasteProfile([]);
    expect(profile.active).toBe(false);
    expect(profile.progress).toBe(0);
    expect(profile.tastingCount).toBe(0);
  });

  it('4건 (5건 미달) — active false, progress 4/5', () => {
    const tastings = Array.from({ length: 4 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, manualRating: 4, country: 'France' }),
    );
    const profile = buildTasteProfile(tastings);
    expect(profile.active).toBe(false);
    expect(profile.progress).toBeCloseTo(0.8, 5);
    expect(profile.liked).toEqual([]); // 비활성 시 계산하지 않음
  });

  it('5건 경계 — active true, progress 1', () => {
    const tastings = Array.from({ length: 5 }, (_, i) =>
      makeTasting({ tastingId: `t${i}`, manualRating: 4, country: 'France' }),
    );
    const profile = buildTasteProfile(tastings);
    expect(profile.active).toBe(true);
    expect(profile.progress).toBe(1);
  });

  it('4점 이상 공통 속성 → liked 에 포함', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', manualRating: 4, country: 'France' }),
      makeTasting({ tastingId: 't2', manualRating: 5, country: 'France' }),
      makeTasting({ tastingId: 't3', manualRating: 4, country: 'France' }),
      makeTasting({ tastingId: 't4', manualRating: 2, country: 'Italy' }),
      makeTasting({ tastingId: 't5', manualRating: 4, country: 'France' }),
    ];
    const profile = buildTasteProfile(tastings);
    const franceLiked = profile.liked.find((a) => a.dimension === 'country' && a.key === 'France');
    expect(franceLiked).toBeDefined();
    expect(franceLiked?.n).toBe(4);
  });

  it('2점 이하 공통 속성 → disliked 에 포함', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', manualRating: 2, country: 'Germany' }),
      makeTasting({ tastingId: 't2', manualRating: 1, country: 'Germany' }),
      makeTasting({ tastingId: 't3', manualRating: 2, country: 'Germany' }),
      makeTasting({ tastingId: 't4', manualRating: 5, country: 'France' }),
      makeTasting({ tastingId: 't5', manualRating: 5, country: 'France' }),
    ];
    const profile = buildTasteProfile(tastings);
    const germanyDisliked = profile.disliked.find(
      (a) => a.dimension === 'country' && a.key === 'Germany',
    );
    expect(germanyDisliked).toBeDefined();
    expect(germanyDisliked?.n).toBe(3);
  });

  it('표본 3건 미만인 속성은 grade reference', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', manualRating: 4, country: 'Spain' }),
      makeTasting({ tastingId: 't2', manualRating: 4, country: 'Spain' }),
      makeTasting({ tastingId: 't3', manualRating: 4, country: 'France' }),
      makeTasting({ tastingId: 't4', manualRating: 4, country: 'France' }),
      makeTasting({ tastingId: 't5', manualRating: 4, country: 'France' }),
    ];
    const profile = buildTasteProfile(tastings);
    const spain = profile.liked.find((a) => a.key === 'Spain');
    const france = profile.liked.find((a) => a.key === 'France');
    expect(spain?.grade).toBe('reference'); // n=2 < 3
    expect(france?.grade).toBe('solid'); // n=3 >= 3
  });

  it('표본 정확히 3건 경계 — grade solid', () => {
    const tastings = [
      makeTasting({ tastingId: 't1', manualRating: 4, country: 'Chile' }),
      makeTasting({ tastingId: 't2', manualRating: 4, country: 'Chile' }),
      makeTasting({ tastingId: 't3', manualRating: 4, country: 'Chile' }),
      makeTasting({ tastingId: 't4', manualRating: 4, country: 'Chile' }),
      makeTasting({ tastingId: 't5', manualRating: 4, country: 'Chile' }),
    ];
    const profile = buildTasteProfile(tastings);
    const chile = profile.liked.find((a) => a.key === 'Chile');
    expect(chile?.grade).toBe('solid');
    expect(chile?.n).toBe(5);
  });

  it('5축 평균 axes 산출', () => {
    const tastings = [
      makeTasting({
        tastingId: 't1',
        notes: { acidity: 4, tannin: 3, body: 3, aroma: 4, finish: 3 },
      }),
      makeTasting({
        tastingId: 't2',
        notes: { acidity: 2, tannin: 3, body: 3, aroma: 4, finish: 3 },
      }),
      makeTasting({
        tastingId: 't3',
        notes: { acidity: 3, tannin: 3, body: 3, aroma: 4, finish: 3 },
      }),
      makeTasting({
        tastingId: 't4',
        notes: { acidity: 3, tannin: 3, body: 3, aroma: 4, finish: 3 },
      }),
      makeTasting({
        tastingId: 't5',
        notes: { acidity: 3, tannin: 3, body: 3, aroma: 4, finish: 3 },
      }),
    ];
    const profile = buildTasteProfile(tastings);
    expect(profile.axes?.acidity).toBeCloseTo(3, 5); // (4+2+3+3+3)/5
    expect(profile.axes?.aroma).toBe(4);
  });

  it('노트가 전혀 없으면 axes 는 undefined', () => {
    const tastings = Array.from({ length: 5 }, (_, i) => makeTasting({ tastingId: `t${i}` }));
    const profile = buildTasteProfile(tastings);
    expect(profile.axes).toBeUndefined();
  });
});

describe('shouldRefreshProfile', () => {
  it('0건이면 false', () => {
    expect(shouldRefreshProfile(0)).toBe(false);
  });

  it('5의 배수일 때만 true', () => {
    expect(shouldRefreshProfile(5)).toBe(true);
    expect(shouldRefreshProfile(10)).toBe(true);
    expect(shouldRefreshProfile(15)).toBe(true);
  });

  it('5의 배수가 아니면 false', () => {
    expect(shouldRefreshProfile(4)).toBe(false);
    expect(shouldRefreshProfile(6)).toBe(false);
    expect(shouldRefreshProfile(11)).toBe(false);
  });
});

describe('assessFit', () => {
  const activeProfile = buildTasteProfile([
    makeTasting({ tastingId: 't1', manualRating: 5, country: 'France', grapes: ['Pinot Noir'] }),
    makeTasting({ tastingId: 't2', manualRating: 5, country: 'France', grapes: ['Pinot Noir'] }),
    makeTasting({ tastingId: 't3', manualRating: 5, country: 'France', grapes: ['Pinot Noir'] }),
    makeTasting({ tastingId: 't4', manualRating: 1, country: 'Germany', grapes: ['Riesling'] }),
    makeTasting({ tastingId: 't5', manualRating: 1, country: 'Germany', grapes: ['Riesling'] }),
  ]);

  it('비활성 프로파일이면 unknown', () => {
    const inactive = buildTasteProfile([]);
    expect(assessFit(inactive, { country: 'France' })).toBe('unknown');
  });

  it('liked 속성과 겹치고 disliked 와 겹치지 않으면 perfect', () => {
    expect(assessFit(activeProfile, { country: 'France', grapes: ['Pinot Noir'] })).toBe('perfect');
  });

  it('disliked 속성과 겹치고 liked 와 겹치지 않으면 dislike', () => {
    expect(assessFit(activeProfile, { country: 'Germany', grapes: ['Riesling'] })).toBe('dislike');
  });

  it('liked·disliked 양쪽에 걸치면 challenging', () => {
    expect(assessFit(activeProfile, { country: 'France', grapes: ['Riesling'] })).toBe(
      'challenging',
    );
  });

  it('겹치는 속성이 전혀 없으면 unknown', () => {
    expect(assessFit(activeProfile, { country: 'Japan', grapes: ['Koshu'] })).toBe('unknown');
  });
});
