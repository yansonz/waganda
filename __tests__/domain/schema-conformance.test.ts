/**
 * 도메인 순수 함수의 산출물이 **저장 스키마 검증을 통과**하는지 확인한다.
 *
 * 배경: `buildTasteProfile` 이 만드는 5축 평균은 임의의 실수(예: 3.4)인데
 * 프로파일 스키마가 개별 노트용 0.5 단위 검증기를 재사용하고 있어
 * 실제 저장 시점에 항상 실패하는 결함이 있었다. E2E 시드가 이를 드러냈고,
 * 이 테스트가 재발을 막는다.
 */
import { describe, expect, it } from 'vitest';
import { TasteProfile, CURRENT_SCHEMA_VERSION } from '@waganda/schemas';
import { buildTasteProfile } from '@/lib/domain/profile';
import type { StatsInputTasting } from '@/lib/domain/types';

/** 평균이 0.5 단위로 떨어지지 않는 노트 조합을 의도적으로 만든다 */
function makeTastings(count: number): StatsInputTasting[] {
  return Array.from({ length: count }, (_, i) => ({
    tastingId: `t${i}`,
    wineId: `w${i}`,
    wineName: `와인 ${i}`,
    tastedAt: new Date(2026, 0, i + 1).toISOString(),
    rating: 4,
    manualRating: 4,
    aiRating: 4,
    notes: {
      // 3건 평균이 각각 3.333.../4.666... 처럼 0.5 단위가 아니게 나오도록 구성
      acidity: (i % 3) + 3 > 5 ? 5 : (i % 3) + 3,
      tannin: (i % 2) + 3,
      body: (i % 3) + 2,
      aroma: (i % 3) + 3 > 5 ? 5 : (i % 3) + 3,
      finish: (i % 2) + 4 > 5 ? 5 : (i % 2) + 4,
    },
    grapes: ['Merlot'],
    country: '프랑스',
    regionId: 'r1',
    priceBand: '50k_100k',
    labelTags: [],
    hadLaughter: false,
  })) as StatsInputTasting[];
}

describe('도메인 산출물의 스키마 정합성', () => {
  it('buildTasteProfile 결과가 TasteProfile 스키마 검증을 통과한다 (활성)', () => {
    const profile = buildTasteProfile(makeTastings(7));
    const now = new Date().toISOString();

    const parsed = TasteProfile.safeParse({
      ...profile,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });

    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 2)).toBe(true);
  });

  it('5축 평균이 0.5 단위가 아니어도 검증을 통과한다', () => {
    const profile = buildTasteProfile(makeTastings(3));
    const axisValues = Object.values(profile.axes ?? {});

    expect(axisValues.length).toBeGreaterThan(0);
    // 최소 하나는 0.5 단위가 아닌 평균이어야 이 테스트가 의미를 가진다
    expect(axisValues.some((v) => Math.round(v * 2) !== v * 2)).toBe(true);

    const now = new Date().toISOString();
    const parsed = TasteProfile.safeParse({
      ...profile,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 2)).toBe(true);
  });

  it('5건 미달이면 비활성 상태로도 스키마 검증을 통과한다', () => {
    const profile = buildTasteProfile(makeTastings(2));
    expect(profile.active).toBe(false);

    const now = new Date().toISOString();
    const parsed = TasteProfile.safeParse({
      ...profile,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 2)).toBe(true);
  });
});
