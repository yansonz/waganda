/**
 * lib/domain/discovery.ts 테스트 — 발견 등급 경계, 중복 차단, 실행 조건
 */
import { describe, expect, it } from 'vitest';
import { gradeDiscovery, isDuplicate, shouldRunDiscovery } from '@/lib/domain/discovery';

describe('gradeDiscovery', () => {
  it('n < 4 이면 null (제시하지 않음)', () => {
    expect(gradeDiscovery({ n: 3, deltaVsOverall: 2.0 })).toBeNull();
  });

  it('|delta| < 0.5 이면 null (제시하지 않음)', () => {
    expect(gradeDiscovery({ n: 10, deltaVsOverall: 0.4 })).toBeNull();
  });

  it('n >= 6 and |delta| >= 1.0 이면 strong (뚜렷함)', () => {
    expect(gradeDiscovery({ n: 6, deltaVsOverall: 1.0 })).toBe('strong');
    expect(gradeDiscovery({ n: 8, deltaVsOverall: -1.5 })).toBe('strong');
  });

  it('n >= 5 and |delta| >= 0.7 이면 moderate (보통)', () => {
    expect(gradeDiscovery({ n: 5, deltaVsOverall: 0.7 })).toBe('moderate');
  });

  it('그 외의 경우 weak (약함)', () => {
    // n=4, delta=0.6 → strong/moderate 조건 미달, 최소 조건은 만족
    expect(gradeDiscovery({ n: 4, deltaVsOverall: 0.6 })).toBe('weak');
    // n=5, delta=0.5 → moderate 미달(delta<0.7), 최소 조건 만족
    expect(gradeDiscovery({ n: 5, deltaVsOverall: 0.5 })).toBe('weak');
  });

  it('경계값 정확히 일치 — n=4, delta=0.5 (최소 조건 경계)', () => {
    expect(gradeDiscovery({ n: 4, deltaVsOverall: 0.5 })).toBe('weak');
  });

  it('경계값 바로 아래 — n=3.999 대응 delta=0.49 → null', () => {
    expect(gradeDiscovery({ n: 4, deltaVsOverall: 0.49 })).toBeNull();
  });

  it('음수 delta 도 절대값으로 판정한다', () => {
    expect(gradeDiscovery({ n: 6, deltaVsOverall: -1.2 })).toBe('strong');
  });
});

describe('isDuplicate', () => {
  it('동일 (groupBy, key) 조합이 있으면 true', () => {
    const existing = [{ groupBy: 'country', key: 'France', hidden: false }];
    expect(isDuplicate('country', 'France', existing)).toBe(true);
  });

  it('다른 조합이면 false', () => {
    const existing = [{ groupBy: 'country', key: 'France', hidden: false }];
    expect(isDuplicate('country', 'Italy', existing)).toBe(false);
    expect(isDuplicate('region', 'France', existing)).toBe(false);
  });

  it('숨긴 카드도 중복으로 취급해 재제시하지 않는다', () => {
    const existing = [{ groupBy: 'weekday', key: '0', hidden: true }];
    expect(isDuplicate('weekday', '0', existing)).toBe(true);
  });

  it('빈 목록이면 false', () => {
    expect(isDuplicate('country', 'France', [])).toBe(false);
  });
});

describe('shouldRunDiscovery', () => {
  it('완료 시음 10건 미만이면 false', () => {
    expect(shouldRunDiscovery(9, 0)).toBe(false);
  });

  it('10건 이상이고 마지막 실행 이후 5건 이상 증가했으면 true', () => {
    expect(shouldRunDiscovery(15, 10)).toBe(true);
    expect(shouldRunDiscovery(10, 0)).toBe(true);
  });

  it('10건 이상이지만 마지막 실행 이후 증가폭이 5건 미달이면 false', () => {
    expect(shouldRunDiscovery(14, 10)).toBe(false);
  });

  it('경계값 — 증가폭 정확히 5건이면 true', () => {
    expect(shouldRunDiscovery(15, 10)).toBe(true);
  });
});
