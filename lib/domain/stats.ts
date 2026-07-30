/**
 * lib/domain/stats.ts — computeStats (R7, R8)
 *
 * `ComputeStatsSpec`(제한된 스펙)만 받아 그룹별 통계를 계산한다.
 * 모델에게 산수를 시키지 않고, 코드가 계산한 결과를 에이전트가 해석하도록 하는
 * design.md의 "통계는 코드가 계산한다" 원칙을 구현한다.
 */
import type { ComputeStatsResult, ComputeStatsSpec, StatsGroup } from '@waganda/schemas';
import {
  deriveAgreementBand,
  deriveHourBucket,
  deriveVintageDecade,
  deriveWeekday,
  type StatsInputTasting,
} from './types.js';

/** 그룹핑 키 산출 결과 — 다중값 축은 여러 키를 반환해 여러 그룹에 기여한다 */
function keysForAxis(tasting: StatsInputTasting, groupBy: ComputeStatsSpec['groupBy']): string[] {
  switch (groupBy) {
    case 'grape':
      // 다중값 축 — 한 시음이 여러 품종 그룹에 기여한다
      return tasting.grapes.length > 0 ? tasting.grapes : [];
    case 'country':
      return tasting.country ? [tasting.country] : [];
    case 'region': {
      const regionKey = tasting.regionName ?? tasting.regionId;
      return regionKey ? [regionKey] : [];
    }
    case 'priceBand':
      return tasting.priceBand ? [tasting.priceBand] : [];
    case 'vintageDecade':
      return tasting.vintage !== undefined ? [deriveVintageDecade(tasting.vintage)] : [];
    case 'labelTag':
      // 다중값 축 — 한 시음이 여러 라벨 태그 그룹에 기여한다
      return tasting.labelTags.length > 0 ? tasting.labelTags : [];
    case 'tag':
      // 자유 태그도 다중값 축이다 (표기는 저장 시 정규화되어 있다)
      return tasting.tags && tasting.tags.length > 0 ? tasting.tags : [];
    case 'bottleShape':
      return tasting.bottleShape ? [tasting.bottleShape] : [];
    case 'closure':
      return tasting.closure ? [tasting.closure] : [];
    case 'weekday':
      return [String(tasting.weekday ?? deriveWeekday(tasting.tastedAt))];
    case 'hourBucket':
      return [tasting.hourBucket ?? deriveHourBucket(tasting.tastedAt)];
    case 'daysSincePrevTasting':
      return tasting.daysSincePrevTasting !== undefined
        ? [String(tasting.daysSincePrevTasting)]
        : [];
    case 'hadLaughter':
      return [String(Boolean(tasting.hadLaughter))];
    case 'speakerAgreementBand':
      return tasting.agreementScore !== undefined
        ? [deriveAgreementBand(tasting.agreementScore)]
        : [];
    default: {
      // 타입 단언용 — GroupByAxis 스키마가 확장되면 여기서 컴파일 오류로 드러난다
      const _exhaustive: never = groupBy;
      return _exhaustive;
    }
  }
}

/** metric 계산에 필요한 단일 시음의 값 — 없으면 해당 시음은 그룹 계산에서 제외한다 */
function valueForMetric(tasting: StatsInputTasting, spec: ComputeStatsSpec): number | undefined {
  switch (spec.metric) {
    case 'meanRating':
    case 'ratioAtOrAbove4': {
      // 수동 평점 우선, 없으면 AI 평점
      return tasting.manualRating ?? tasting.aiRating;
    }
    case 'meanNoteAxis': {
      if (!spec.noteAxis) return undefined;
      return tasting.notes?.[spec.noteAxis];
    }
    default:
      return undefined;
  }
}

/** 값 목록으로부터 metric 을 집계한다 */
function aggregate(values: number[], metric: ComputeStatsSpec['metric']): number {
  if (values.length === 0) return 0;
  if (metric === 'ratioAtOrAbove4') {
    const hit = values.filter((v) => v >= 4).length;
    return hit / values.length;
  }
  // meanRating, meanNoteAxis 는 평균
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * 시음 목록과 스펙으로부터 그룹별 통계를 계산한다.
 *
 * - 다중값 축(grape, labelTag)은 한 시음이 여러 그룹에 기여한다.
 * - minSampleSize 미달 그룹은 결과에서 제외한다.
 * - overall 은 전체(필터 없는) 유효 표본의 metric 값이며, 그룹별 deltaVsOverall = value - overall.
 */
export function computeStats(
  tastings: StatsInputTasting[],
  spec: ComputeStatsSpec,
): ComputeStatsResult {
  // 전체 개요값 — metric 계산에 필요한 값이 있는 시음만 포함
  const overallValues: number[] = [];
  for (const t of tastings) {
    const v = valueForMetric(t, spec);
    if (v !== undefined) overallValues.push(v);
  }
  const overall = aggregate(overallValues, spec.metric);

  // 그룹별 값·시음ID 누적
  const groupValues = new Map<string, number[]>();
  const groupTastingIds = new Map<string, string[]>();

  for (const t of tastings) {
    const v = valueForMetric(t, spec);
    if (v === undefined) continue;
    const keys = keysForAxis(t, spec.groupBy);
    for (const key of keys) {
      if (!groupValues.has(key)) {
        groupValues.set(key, []);
        groupTastingIds.set(key, []);
      }
      groupValues.get(key)!.push(v);
      groupTastingIds.get(key)!.push(t.tastingId);
    }
  }

  const groups: StatsGroup[] = [];
  for (const [key, values] of groupValues) {
    if (values.length < spec.minSampleSize) continue;
    const value = aggregate(values, spec.metric);
    groups.push({
      key,
      n: values.length,
      value,
      deltaVsOverall: value - overall,
      tastingIds: groupTastingIds.get(key) ?? [],
    });
  }

  // 표본 수 내림차순, 동률이면 key 오름차순으로 결정론적 정렬
  groups.sort((a, b) => (b.n !== a.n ? b.n - a.n : a.key.localeCompare(b.key)));

  return {
    groups,
    overall,
    totalN: overallValues.length,
    spec: {
      groupBy: spec.groupBy,
      metric: spec.metric,
      noteAxis: spec.noteAxis,
      minSampleSize: spec.minSampleSize,
    },
  };
}
