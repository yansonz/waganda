/**
 * lib/budget.ts — 일간 실행 횟수·월간 모델 비용 예산 가드레일 (design.md '가드레일',
 * tasks.md 16.4).
 *
 * 원래 계획은 `lib/ops/budget.ts`(app 워크스페이스)였으나, 이 세션 기준으로
 * 해당 파일이 아직 만들어지지 않았다. 예산 차단은 "에이전트 실행을 막는다"는
 * 성격상 에이전트 자신도 반드시 검사해야 하는 하드 가드레일이므로, 다른 담당자가
 * app 쪽에 동일 로직을 만들기 전까지 이 모듈이 agent 워크스페이스 자체의
 * 방어선을 담당한다. app 쪽에 동등한 모듈이 생기면 이 파일은 유지하되 카운터
 * 저장소(Repository)를 공유하도록 재조정할 수 있다.
 *
 * DynamoDB 조건부 증가 + TTL 카운터 방식(design.md '남용 방지')과 동일한 패턴을
 * 쓴다. 이 모듈은 스토리지에 의존하지 않는 순수 판정 로직만 제공하고, 실제
 * 카운터 조회/증가는 호출부(그래프 노드)가 주입한 함수로 수행한다 — 테스트에서
 * 인메모리 스텁을 주입하기 쉽게 하기 위함이다.
 */

/** 예산 판정 입력 */
export interface BudgetStatus {
  /** 오늘 누적 실행 횟수 */
  dailyRunCount: number;
  /** 일간 실행 횟수 상한 */
  dailyRunLimit: number;
  /** 이번 달 누적 추정 모델 비용(USD) */
  monthlyModelCostUsd: number;
  /** 월간 모델 비용 예산(USD) */
  monthlyBudgetUsd: number;
}

/** 예산 판정 결과 */
export type BudgetVerdict = 'ok' | 'warning_80' | 'blocked';

export interface BudgetDecision {
  verdict: BudgetVerdict;
  /** 차단 사유 (한국어) — verdict 가 'blocked' 일 때만 존재 */
  reason?: string;
  dailyRatio: number;
  monthlyRatio: number;
}

/**
 * 일간 실행 횟수와 월간 모델 비용으로부터 예산 판정을 내린다.
 *
 * - 일간 실행 횟수가 상한 이상이면 즉시 차단(신규 실행 거부, 익일까지).
 * - 월간 비용이 예산의 100% 이상이면 차단.
 * - 둘 중 하나라도 80% 이상이면 'warning_80' (실행은 허용하되 경고).
 * - 그 외에는 'ok'.
 */
export function evaluateBudget(status: BudgetStatus): BudgetDecision {
  const dailyRatio = status.dailyRunLimit > 0 ? status.dailyRunCount / status.dailyRunLimit : 0;
  const monthlyRatio =
    status.monthlyBudgetUsd > 0 ? status.monthlyModelCostUsd / status.monthlyBudgetUsd : 0;

  if (status.dailyRunCount >= status.dailyRunLimit) {
    return {
      verdict: 'blocked',
      reason: `일간 에이전트 실행 상한(${status.dailyRunLimit}회)에 도달했습니다. 익일 이후 다시 시도하세요.`,
      dailyRatio,
      monthlyRatio,
    };
  }

  if (monthlyRatio >= 1) {
    return {
      verdict: 'blocked',
      reason: `월간 모델 비용 예산(${status.monthlyBudgetUsd}USD)에 도달했습니다. 신규 에이전트 실행이 차단됩니다.`,
      dailyRatio,
      monthlyRatio,
    };
  }

  if (dailyRatio >= 0.8 || monthlyRatio >= 0.8) {
    return { verdict: 'warning_80', dailyRatio, monthlyRatio };
  }

  return { verdict: 'ok', dailyRatio, monthlyRatio };
}

/** 카운터 조회/증가를 담당하는 저장소 계약 — 호출부가 DynamoDB 구현을 주입한다 */
export interface BudgetCounters {
  getDailyRunCount(dateKey: string): Promise<number>;
  incrementDailyRunCount(dateKey: string): Promise<void>;
  getMonthlyModelCostUsd(monthKey: string): Promise<number>;
  addMonthlyModelCostUsd(monthKey: string, deltaUsd: number): Promise<void>;
}

export interface CheckAndReserveBudgetOptions {
  counters: BudgetCounters;
  dailyRunLimit: number;
  monthlyBudgetUsd: number;
  /** 판정 시각 (테스트에서 고정하기 위해 주입 가능, 기본 new Date()) */
  now?: Date;
}

/**
 * 현재 카운터를 조회해 예산을 판정하고, 차단이 아니면 일간 실행 카운터를 증가시킨다
 * (증가까지가 "예약"이며, 이후 실제 실행 여부와 무관하게 카운트된다 — 폭주 방지가
 * 목적이므로 과다 집계 방향의 보수적 설계다).
 *
 * 차단인 경우 카운터를 증가시키지 않고 즉시 'blocked' 를 반환한다.
 */
export async function checkAndReserveBudget(
  options: CheckAndReserveBudgetOptions,
): Promise<BudgetDecision> {
  const now = options.now ?? new Date();
  const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthKey = now.toISOString().slice(0, 7); // YYYY-MM

  const [dailyRunCount, monthlyModelCostUsd] = await Promise.all([
    options.counters.getDailyRunCount(dateKey),
    options.counters.getMonthlyModelCostUsd(monthKey),
  ]);

  const decision = evaluateBudget({
    dailyRunCount,
    dailyRunLimit: options.dailyRunLimit,
    monthlyModelCostUsd,
    monthlyBudgetUsd: options.monthlyBudgetUsd,
  });

  if (decision.verdict !== 'blocked') {
    await options.counters.incrementDailyRunCount(dateKey);
  }

  return decision;
}
