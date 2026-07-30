import { describe, expect, it } from 'vitest';
import { checkAndReserveBudget, evaluateBudget, type BudgetCounters } from '../src/lib/budget.js';

describe('lib/budget — 예산 가드레일', () => {
  it('일간 실행 횟수가 상한 미달이고 월간 비용도 낮으면 ok 를 반환한다', () => {
    const decision = evaluateBudget({
      dailyRunCount: 1,
      dailyRunLimit: 50,
      monthlyModelCostUsd: 1,
      monthlyBudgetUsd: 10,
    });
    expect(decision.verdict).toBe('ok');
  });

  it('일간 또는 월간 비율이 80% 이상이면 warning_80 을 반환한다', () => {
    const decision = evaluateBudget({
      dailyRunCount: 40,
      dailyRunLimit: 50,
      monthlyModelCostUsd: 1,
      monthlyBudgetUsd: 10,
    });
    expect(decision.verdict).toBe('warning_80');
  });

  it('월간 비용이 예산의 100% 이상이면 신규 실행이 차단된다', () => {
    const decision = evaluateBudget({
      dailyRunCount: 1,
      dailyRunLimit: 50,
      monthlyModelCostUsd: 10,
      monthlyBudgetUsd: 10,
    });
    expect(decision.verdict).toBe('blocked');
    expect(decision.reason).toContain('차단');
  });

  it('일간 실행 횟수가 상한에 도달하면 신규 실행이 차단된다', () => {
    const decision = evaluateBudget({
      dailyRunCount: 50,
      dailyRunLimit: 50,
      monthlyModelCostUsd: 0,
      monthlyBudgetUsd: 10,
    });
    expect(decision.verdict).toBe('blocked');
  });

  it('checkAndReserveBudget 은 예산 100% 도달 시 카운터를 증가시키지 않고 차단한다', async () => {
    const daily = new Map<string, number>();
    const monthly = new Map<string, number>();
    const counters: BudgetCounters = {
      getDailyRunCount: async (key) => daily.get(key) ?? 0,
      incrementDailyRunCount: async (key) => {
        daily.set(key, (daily.get(key) ?? 0) + 1);
      },
      getMonthlyModelCostUsd: async (key) => monthly.get(key) ?? 10,
      addMonthlyModelCostUsd: async (key, delta) => {
        monthly.set(key, (monthly.get(key) ?? 0) + delta);
      },
    };

    const decision = await checkAndReserveBudget({
      counters,
      dailyRunLimit: 50,
      monthlyBudgetUsd: 10,
      now: new Date('2026-07-29T00:00:00Z'),
    });

    expect(decision.verdict).toBe('blocked');
    expect(await counters.getDailyRunCount('2026-07-29')).toBe(0);
  });

  it('checkAndReserveBudget 은 차단이 아니면 일간 실행 카운터를 증가시킨다', async () => {
    const daily = new Map<string, number>();
    const counters: BudgetCounters = {
      getDailyRunCount: async (key) => daily.get(key) ?? 0,
      incrementDailyRunCount: async (key) => {
        daily.set(key, (daily.get(key) ?? 0) + 1);
      },
      getMonthlyModelCostUsd: async () => 0,
      addMonthlyModelCostUsd: async () => {},
    };

    await checkAndReserveBudget({
      counters,
      dailyRunLimit: 50,
      monthlyBudgetUsd: 10,
      now: new Date('2026-07-29T00:00:00Z'),
    });

    expect(await counters.getDailyRunCount('2026-07-29')).toBe(1);
  });
});
