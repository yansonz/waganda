/**
 * lib/domain/discovery.ts — 발견 카드 판정 (R8)
 *
 * 여러 축을 동시에 탐색하면 우연한 상관이 반드시 나온다. 등급 기준을
 * 코드로 고정해 다중 비교 문제를 완화한다 (design.md '발견 카드 판정').
 */
import {
  DISCOVERY_MIN_INCREMENT,
  DISCOVERY_MIN_TASTINGS,
  DISCOVERY_THRESHOLDS,
  type DiscoveryGrade,
} from '@waganda/schemas';

/** 발견 후보 등급 판정에 필요한 최소 입력 */
export interface DiscoveryGroupInput {
  n: number;
  deltaVsOverall: number;
}

/**
 * 그룹 통계와 전체 개요로부터 발견 등급을 판정한다.
 *
 * - n < 4 또는 |delta| < 0.5 → null (제시하지 않음)
 * - n >= 6 and |delta| >= 1.0 → 'strong' (뚜렷함)
 * - n >= 5 and |delta| >= 0.7 → 'moderate' (보통)
 * - 그 외 → 'weak' (약함)
 *
 * `overall` 파라미터는 시그니처 문서화 목적으로만 존재한다 — 실제 delta는
 * 호출부(computeStats)가 이미 산출한 `deltaVsOverall`을 그대로 사용한다.
 */
export function gradeDiscovery(
  group: DiscoveryGroupInput,
  _overall?: number,
): DiscoveryGrade | null {
  const absDelta = Math.abs(group.deltaVsOverall);

  if (group.n < DISCOVERY_THRESHOLDS.minSampleSize || absDelta < DISCOVERY_THRESHOLDS.minAbsDelta) {
    return null;
  }

  if (group.n >= DISCOVERY_THRESHOLDS.strong.n && absDelta >= DISCOVERY_THRESHOLDS.strong.delta) {
    return 'strong';
  }

  if (
    group.n >= DISCOVERY_THRESHOLDS.moderate.n &&
    absDelta >= DISCOVERY_THRESHOLDS.moderate.delta
  ) {
    return 'moderate';
  }

  return 'weak';
}

/** 중복 판정 대상이 되는 기존 발견 카드의 최소 정보 */
export interface ExistingDiscoveryKey {
  groupBy: string;
  key: string;
  /** 숨긴 카드도 중복으로 취급해 재제시하지 않는다 */
  hidden: boolean;
}

/**
 * (groupBy, key) 조합이 기존 발견 카드 목록에 이미 존재하는지 판정한다.
 * 숨긴 카드도 중복으로 취급한다 — 편집자가 숨긴 패턴은 재제시하지 않는다 (R8).
 */
export function isDuplicate(
  groupBy: string,
  key: string,
  existing: ExistingDiscoveryKey[],
): boolean {
  return existing.some((d) => d.groupBy === groupBy && d.key === key);
}

/**
 * 패턴 발견 에이전트 실행 여부를 결정론적으로 판정한다 (R8).
 *
 * - 완료 시음 10건 미만 → 실행하지 않음
 * - 마지막 실행 이후 5건 이상 증가하지 않았으면 → 실행하지 않음
 *
 * @param completedCount 현재까지 완료된 시음 건수
 * @param lastRunAtCount 마지막 발견 실행 시점의 완료 시음 건수 (실행 이력이 없으면 0)
 */
export function shouldRunDiscovery(completedCount: number, lastRunAtCount: number): boolean {
  if (completedCount < DISCOVERY_MIN_TASTINGS) return false;
  return completedCount - lastRunAtCount >= DISCOVERY_MIN_INCREMENT;
}
