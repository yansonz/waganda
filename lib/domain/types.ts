/**
 * lib/domain/** 순수 함수들이 공유하는 결합 뷰 타입 정의.
 *
 * 여기서는 Zod 스키마를 재정의하지 않는다 — 순수 TypeScript 타입만 둔다.
 * DB 리포지토리 계층(`lib/db/**`)이 여러 엔티티(시음·와인·와이너리·지역·분석)를
 * 조합해 이 형태로 매핑해 준다는 전제로 도메인 함수들을 작성한다.
 */
import type {
  BottleShape,
  Closure,
  LabelTag,
  NoteAxis,
  PriceBand,
  WineType,
} from '@waganda/schemas';

/**
 * `computeStats`, `buildTasteProfile`, `gradeDiscovery` 등 도메인 계산 함수가
 * 공통으로 소비하는 "시음 + 와인 + 분석"이 결합된 평면 뷰.
 *
 * 각 필드는 원본 엔티티에서 파생되며, 다중값 축(`grapes`, `labelTags`)은
 * 배열 그대로 유지해 호출부에서 한 시음이 여러 그룹에 기여하도록 한다.
 */
export interface StatsInputTasting {
  /** 시음 세션 ID */
  tastingId: string;
  /** 시음 시각 (ISO 8601) */
  tastedAt: string;

  /** 수동 평점 (1~5, 0.5 단위) — 있으면 meanRating 계산에서 AI 평점보다 우선한다 */
  manualRating?: number;
  /** AI 평점 (1~5, 0.5 단위) */
  aiRating?: number;

  /** 5축 시음 노트 (분석이 없으면 undefined) */
  notes?: Partial<Record<NoteAxis, number>>;

  /** 와인 품종 — 다중값 축 */
  grapes: string[];
  /** 국가 */
  country?: string;
  /** 지역 경로의 최상위 표시 이름(또는 지역 ID) — country 다음 단계 그룹핑 키로 사용 */
  regionId?: string;
  regionName?: string;
  /** 가격대 */
  priceBand?: PriceBand;
  /** 빈티지 연도 (예: 2018) — vintageDecade 파생에 사용 */
  vintage?: number;
  /** 라벨 시각 태그 — 다중값 축 */
  /** 자유 태그 (라벨 모티프 + 특징) */
  tags?: string[];
  labelTags: LabelTag[];
  /** 병 형태 */
  bottleShape?: BottleShape;
  /** 마감 방식 */
  closure?: Closure;
  /** 와인 색/유형 (참고용, 현재 groupBy 축에는 없음) */
  wineType?: WineType;

  /** 시음 시각의 요일 (0=일 ~ 6=토) — hourBucket/weekday 파생용으로 호출부가 채워 넣거나, tastedAt에서 계산 */
  weekday?: number;
  /** 시음 시각의 시간대 버킷 (예: 'morning' | 'afternoon' | 'evening' | 'night') */
  hourBucket?: string;
  /** 직전 시음과의 간격(일) — 호출부가 정렬 후 계산해 채운다 */
  daysSincePrevTasting?: number;

  /** 웃음 후보 구간이 있었는지 (음향 특징에서 파생) */
  hadLaughter?: boolean;
  /** 반응 일치도 (0~100) — 두 화자 구분 시에만 존재 */
  agreementScore?: number;
}

/** 요일·시간대 파생에 쓰는 시간대 버킷 라벨 */
export type HourBucketLabel = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * `tastedAt`(ISO 8601, 로컬 시각 오프셋 포함)에서 요일(0~6, 일요일=0)을 계산한다.
 * 순수 함수 — Date.now() 등 현재 시각에 의존하지 않는다.
 */
export function deriveWeekday(tastedAt: string): number {
  return new Date(tastedAt).getDay();
}

/**
 * `tastedAt`의 시(hour, 0~23)로부터 시간대 버킷을 계산한다.
 * 05~10 dawn, 11~13 morning, 14~17 afternoon, 18~21 evening, 22~04 night.
 */
export function deriveHourBucket(tastedAt: string): HourBucketLabel {
  const hour = new Date(tastedAt).getHours();
  if (hour >= 5 && hour <= 10) return 'dawn';
  if (hour >= 11 && hour <= 13) return 'morning';
  if (hour >= 14 && hour <= 17) return 'afternoon';
  if (hour >= 18 && hour <= 21) return 'evening';
  return 'night';
}

/** 빈티지 연도에서 연대(decade) 문자열을 계산한다 (예: 2018 → "2010s") */
export function deriveVintageDecade(vintage: number): string {
  const decade = Math.floor(vintage / 10) * 10;
  return `${decade}s`;
}

/** 반응 일치도 밴드 — speakerAgreementBand 축의 키로 쓴다 */
export type AgreementBand = 'low' | 'medium' | 'high';

/** agreementScore(0~100)를 밴드로 변환한다. < 40 low, 40~<75 medium, >=75 high */
export function deriveAgreementBand(agreementScore: number): AgreementBand {
  if (agreementScore < 40) return 'low';
  if (agreementScore < 75) return 'medium';
  return 'high';
}
