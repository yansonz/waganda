/**
 * 단일 테이블 설계의 키 생성/파싱 함수.
 *
 * design.md '데이터 모델 > 키 구조' 표를 그대로 코드화한다.
 *
 * | 엔티티 | pk | sk | gsi1pk | gsi1sk |
 * | --- | --- | --- | --- | --- |
 * | 와인 | WINE#<id> | META | TYPE#WINE | <정규화된 이름> |
 * | 와이너리 | WINERY#<id> | META | TYPE#WINERY | <정규화된 이름> |
 * | 지역 | REGION#<id> | META | TYPE#REGION | <경로 문자열> |
 * | 시음 세션 | TASTING#<id> | META | TYPE#TASTING | <tastedAt ISO>#<id> |
 * | 녹음 | TASTING#<id> | REC#<recId> | — | — |
 * | 분석 결과 | TASTING#<id> | ANALYSIS | — | — |
 * | 분석 작업 | TASTING#<id> | JOB | TYPE#JOB#<status> | <updatedAt> |
 * | 취향 프로파일 | PROFILE | CURRENT | — | — |
 * | 발견 카드 | DISCOVERY#<id> | META | TYPE#DISCOVERY | <createdAt>#<id> |
 * | 속도 제한 카운터 | RATE#<ipHash> | <윈도우> | — | — (TTL) |
 */

/**
 * GSI 물리 이름. CDK(`infrastructure/lib/data-stack.ts`)가 만드는 인덱스 이름과
 * **반드시 일치**해야 한다. 대소문자가 어긋나면 모든 목록 조회가 런타임에 실패한다.
 */
export const GSI1_INDEX_NAME = 'GSI1';

/** GSI1 상의 엔티티 타입 마커 */
export type Gsi1EntityType = 'WINE' | 'WINERY' | 'REGION' | 'TASTING' | 'DISCOVERY';

/** 파싱된 키에서 식별 가능한 엔티티 종류 */
export type EntityKind =
  | 'WINE'
  | 'WINERY'
  | 'REGION'
  | 'TASTING'
  | 'RECORDING'
  | 'ANALYSIS'
  | 'JOB'
  | 'PROFILE'
  | 'DISCOVERY'
  | 'RATE'
  | 'UNKNOWN';

export interface ParsedKey {
  kind: EntityKind;
  /** 엔티티 식별자 (WINE/WINERY/REGION/TASTING/DISCOVERY 는 해당 id, RATE 는 ipHash) */
  id?: string;
  /** RECORDING 인 경우의 녹음 id */
  recordingId?: string;
  /** RATE 인 경우의 윈도우 값(sk 원문) */
  window?: string;
}

/* ── 이름 정규화 ─────────────────────────────────────────────────── */

/**
 * 검색·GSI1 정렬 키에 쓰이는 이름 정규화.
 * - NFKC 정규화 (전각/반각, 합성 문자 통일)
 * - 소문자화
 * - 앞뒤 공백 제거 + 내부 연속 공백을 단일 공백으로 축약
 */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/* ── 와인 ─────────────────────────────────────────────────────────── */

export function winePk(id: string): string {
  return `WINE#${id}`;
}

export const WINE_SK = 'META';

export function wineGsi1(name: string): { gsi1pk: string; gsi1sk: string } {
  return { gsi1pk: 'TYPE#WINE', gsi1sk: normalizeName(name) };
}

/* ── 와이너리 ─────────────────────────────────────────────────────── */

export function wineryPk(id: string): string {
  return `WINERY#${id}`;
}

export const WINERY_SK = 'META';

export function wineryGsi1(name: string): { gsi1pk: string; gsi1sk: string } {
  return { gsi1pk: 'TYPE#WINERY', gsi1sk: normalizeName(name) };
}

/* ── 지역 ─────────────────────────────────────────────────────────── */

export function regionPk(id: string): string {
  return `REGION#${id}`;
}

export const REGION_SK = 'META';

/** 지역 GSI1 정렬 키 — 경로 문자열 (예: "korea/영남/경산") */
export function regionGsi1(pathString: string): { gsi1pk: string; gsi1sk: string } {
  return { gsi1pk: 'TYPE#REGION', gsi1sk: pathString };
}

/* ── 시음 세션 (META) ─────────────────────────────────────────────── */

export function tastingPk(id: string): string {
  return `TASTING#${id}`;
}

export const TASTING_META_SK = 'META';

export function tastingGsi1(tastedAt: string, id: string): { gsi1pk: string; gsi1sk: string } {
  return { gsi1pk: 'TYPE#TASTING', gsi1sk: `${tastedAt}#${id}` };
}

/* ── 녹음 (같은 파티션, sk = REC#<recId>) ─────────────────────────── */

export function recordingSk(recordingId: string): string {
  return `REC#${recordingId}`;
}

/** sk 가 REC#<recId> 형태인지 판별 */
export function isRecordingSk(sk: string): boolean {
  return sk.startsWith('REC#');
}

export function recordingIdFromSk(sk: string): string | undefined {
  return isRecordingSk(sk) ? sk.slice('REC#'.length) : undefined;
}

/* ── 분석 결과 (같은 파티션, sk = ANALYSIS) ───────────────────────── */

export const ANALYSIS_SK = 'ANALYSIS';

/* ── 분석 작업 (같은 파티션, sk = JOB) ────────────────────────────── */

export const JOB_SK = 'JOB';

export function jobGsi1(status: string, updatedAt: string): { gsi1pk: string; gsi1sk: string } {
  return { gsi1pk: `TYPE#JOB#${status}`, gsi1sk: updatedAt };
}

/* ── 취향 프로파일 (싱글턴) ───────────────────────────────────────── */

export const PROFILE_PK = 'PROFILE';
export const PROFILE_SK = 'CURRENT';

/* ── 발견 카드 ─────────────────────────────────────────────────────── */

export function discoveryPk(id: string): string {
  return `DISCOVERY#${id}`;
}

export const DISCOVERY_SK = 'META';

export function discoveryGsi1(createdAt: string, id: string): { gsi1pk: string; gsi1sk: string } {
  return { gsi1pk: 'TYPE#DISCOVERY', gsi1sk: `${createdAt}#${id}` };
}

/* ── 속도 제한 카운터 (TTL 대상, GSI1 없음) ───────────────────────── */

export function ratePk(ipHash: string): string {
  return `RATE#${ipHash}`;
}

export function rateSk(window: string): string {
  return window;
}

/* ── 키 파싱 (역함수) ─────────────────────────────────────────────── */

/**
 * pk/sk 조합으로부터 엔티티 종류와 식별자를 역으로 복원한다.
 * 리포지토리 계층에서 Query/Scan 결과를 분류할 때 사용한다.
 */
export function parseKey(pk: string, sk: string): ParsedKey {
  if (pk === PROFILE_PK && sk === PROFILE_SK) {
    return { kind: 'PROFILE' };
  }

  if (pk.startsWith('RATE#')) {
    return { kind: 'RATE', id: pk.slice('RATE#'.length), window: sk };
  }

  if (pk.startsWith('WINE#') && sk === WINE_SK) {
    return { kind: 'WINE', id: pk.slice('WINE#'.length) };
  }

  if (pk.startsWith('WINERY#') && sk === WINERY_SK) {
    return { kind: 'WINERY', id: pk.slice('WINERY#'.length) };
  }

  if (pk.startsWith('REGION#') && sk === REGION_SK) {
    return { kind: 'REGION', id: pk.slice('REGION#'.length) };
  }

  if (pk.startsWith('DISCOVERY#') && sk === DISCOVERY_SK) {
    return { kind: 'DISCOVERY', id: pk.slice('DISCOVERY#'.length) };
  }

  if (pk.startsWith('TASTING#')) {
    const tastingId = pk.slice('TASTING#'.length);
    if (sk === TASTING_META_SK) {
      return { kind: 'TASTING', id: tastingId };
    }
    if (sk === ANALYSIS_SK) {
      return { kind: 'ANALYSIS', id: tastingId };
    }
    if (sk === JOB_SK) {
      return { kind: 'JOB', id: tastingId };
    }
    if (isRecordingSk(sk)) {
      return { kind: 'RECORDING', id: tastingId, recordingId: recordingIdFromSk(sk) };
    }
  }

  return { kind: 'UNKNOWN' };
}
