/**
 * lib/domain/agreement.ts 테스트 — 반응 일치도 정규화 경계, 월별 집계
 */
import { describe, expect, it } from 'vitest';
import { aggregateByMonth, computeAgreementScore } from '@/lib/domain/agreement';

describe('computeAgreementScore', () => {
  it('완전 일치(intensity, valence 동일)이면 100', () => {
    const a = { intensity: 0.8, valence: 0.5 };
    const b = { intensity: 0.8, valence: 0.5 };
    expect(computeAgreementScore(a, b)).toBe(100);
  });

  it('완전 불일치(intensity 차 1, valence 차 2)이면 0', () => {
    const a = { intensity: 1, valence: 1 };
    const b = { intensity: 0, valence: -1 };
    expect(computeAgreementScore(a, b)).toBe(0);
  });

  it('중간값 — intensity 차 0.5, valence 차 1', () => {
    const a = { intensity: 1, valence: 0.5 };
    const b = { intensity: 0.5, valence: -0.5 };
    // intensityDiff=0.5(정규화 0.5), valenceDiff=1(정규화 0.5)
    // penalty = 0.5*50 + 0.5*50 = 50 → score 50
    expect(computeAgreementScore(a, b)).toBe(50);
  });

  it('score 는 항상 0 이상 100 이하로 clamp 된다', () => {
    const a = { intensity: 1, valence: 1 };
    const b = { intensity: 0, valence: -1 };
    const score = computeAgreementScore(a, b);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('intensity 만 다르고 valence 는 같으면 그 차이만 반영', () => {
    const a = { intensity: 1, valence: 0 };
    const b = { intensity: 0, valence: 0 };
    // intensityDiff=1(정규화1), valenceDiff=0 → penalty=50 → score 50
    expect(computeAgreementScore(a, b)).toBe(50);
  });
});

describe('aggregateByMonth', () => {
  it('빈 배열이면 빈 결과', () => {
    expect(aggregateByMonth([])).toEqual([]);
  });

  it('같은 달의 항목들을 평균과 n으로 집계', () => {
    const entries = [
      { at: '2024-03-01T10:00:00Z', score: 80 },
      { at: '2024-03-15T10:00:00Z', score: 60 },
    ];
    const result = aggregateByMonth(entries);
    expect(result).toHaveLength(1);
    expect(result[0].month).toBe('2024-03');
    expect(result[0].meanScore).toBe(70);
    expect(result[0].n).toBe(2);
  });

  it('여러 달에 걸친 항목은 월별로 분리되고 오름차순 정렬된다', () => {
    const entries = [
      { at: '2024-05-01T00:00:00Z', score: 90 },
      { at: '2024-01-01T00:00:00Z', score: 50 },
      { at: '2024-03-01T00:00:00Z', score: 70 },
    ];
    const result = aggregateByMonth(entries);
    expect(result.map((r) => r.month)).toEqual(['2024-01', '2024-03', '2024-05']);
  });

  it('단일 그룹(항목 1개)도 정상 집계된다', () => {
    const result = aggregateByMonth([{ at: '2024-07-01T00:00:00Z', score: 42 }]);
    expect(result).toEqual([{ month: '2024-07', meanScore: 42, n: 1 }]);
  });
});
