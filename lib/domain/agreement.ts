/**
 * lib/domain/agreement.ts — 반응 일치도 (R6, R7)
 *
 * 두 화자가 구분된 경우에만 산출한다. 개인별 취향 벡터가 없어도 계산되도록
 * "세션 내 상대 지표"로 정의한다 (design.md '반응 일치도').
 *
 * agreementScore = 100 - (|intensity 차이| * w1 + |valence 차이| * w2) 를 0~100 정규화
 */
import type { SpeakerReaction } from '@waganda/schemas';

/** 감정 강도 차이의 가중치 */
export const AGREEMENT_WEIGHT_INTENSITY = 50;
/** 평가 방향 차이의 가중치 */
export const AGREEMENT_WEIGHT_VALENCE = 50;

/**
 * 두 화자의 반응(감정 강도 intensity: 0~1, 평가 방향 valence: -1~1)으로부터
 * 반응 일치도를 0~100 사이로 계산한다.
 *
 * intensity 차이의 최대값은 1(0~1 범위이므로), valence 차이의 최대값은 2(-1~1 범위이므로).
 * 각각을 0~1로 정규화한 뒤 가중합하여 100에서 뺀다. 경계값(완전 일치=100, 완전 불일치=0)을 보장한다.
 */
export function computeAgreementScore(a: SpeakerReaction, b: SpeakerReaction): number {
  const intensityDiffNormalized = Math.abs(a.intensity - b.intensity); // 0~1
  const valenceDiffNormalized = Math.abs(a.valence - b.valence) / 2; // 0~2 범위를 0~1로 정규화

  const penalty =
    intensityDiffNormalized * AGREEMENT_WEIGHT_INTENSITY +
    valenceDiffNormalized * AGREEMENT_WEIGHT_VALENCE;

  const score = 100 - penalty;

  // 경계값 0/100 보장 — 부동소수 오차로 범위를 벗어나지 않도록 clamp
  return Math.max(0, Math.min(100, score));
}

/** 월별 집계 입력 — 반응 일치도 시점과 값 */
export interface AgreementEntry {
  /** ISO 8601 시각 */
  at: string;
  score: number;
}

/** 월별 집계 결과 포인트 */
export interface MonthlyAgreement {
  /** YYYY-MM */
  month: string;
  meanScore: number;
  n: number;
}

/** YYYY-MM 별로 반응 일치도의 평균과 표본 수를 집계한다. 월 오름차순으로 정렬해 반환한다 */
export function aggregateByMonth(entries: AgreementEntry[]): MonthlyAgreement[] {
  const buckets = new Map<string, number[]>();

  for (const entry of entries) {
    const date = new Date(entry.at);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(month)) buckets.set(month, []);
    buckets.get(month)!.push(entry.score);
  }

  const result: MonthlyAgreement[] = [];
  for (const [month, scores] of buckets) {
    const meanScore = scores.reduce((acc, s) => acc + s, 0) / scores.length;
    result.push({ month, meanScore, n: scores.length });
  }

  result.sort((a, b) => a.month.localeCompare(b.month));
  return result;
}
