import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_SK,
  DISCOVERY_SK,
  JOB_SK,
  PROFILE_PK,
  PROFILE_SK,
  REGION_SK,
  TASTING_META_SK,
  WINE_SK,
  WINERY_SK,
  discoveryGsi1,
  discoveryPk,
  isRecordingSk,
  jobGsi1,
  normalizeName,
  parseKey,
  ratePk,
  rateSk,
  recordingIdFromSk,
  recordingSk,
  regionGsi1,
  regionPk,
  tastingGsi1,
  tastingPk,
  wineGsi1,
  winePk,
  wineryGsi1,
  wineryPk,
} from '@/lib/db/keys';

describe('normalizeName', () => {
  it('소문자화하고 앞뒤 공백을 제거한다', () => {
    expect(normalizeName('  Château Margaux  ')).toBe('château margaux');
  });

  it('내부 연속 공백을 단일 공백으로 축약한다', () => {
    expect(normalizeName('Domaine   de   la   Romanée')).toBe('domaine de la romanée');
  });

  it('NFKC 정규화로 전각/합성 문자를 통일한다', () => {
    // 전각 알파벳 'Ａ' → 반각 'a' (소문자화까지 포함)
    expect(normalizeName('Ａ　Wine')).toBe('a wine');
  });

  it('빈 문자열도 처리한다', () => {
    expect(normalizeName('   ')).toBe('');
  });
});

describe('키 생성 함수', () => {
  it('와인 키 — pk/sk/gsi1', () => {
    expect(winePk('w1')).toBe('WINE#w1');
    expect(WINE_SK).toBe('META');
    expect(wineGsi1('Barolo')).toEqual({ gsi1pk: 'TYPE#WINE', gsi1sk: 'barolo' });
  });

  it('와이너리 키', () => {
    expect(wineryPk('wy1')).toBe('WINERY#wy1');
    expect(WINERY_SK).toBe('META');
    expect(wineryGsi1('Antinori')).toEqual({ gsi1pk: 'TYPE#WINERY', gsi1sk: 'antinori' });
  });

  it('지역 키 — gsi1sk 는 경로 문자열', () => {
    expect(regionPk('r1')).toBe('REGION#r1');
    expect(REGION_SK).toBe('META');
    expect(regionGsi1('korea/영남/경산')).toEqual({
      gsi1pk: 'TYPE#REGION',
      gsi1sk: 'korea/영남/경산',
    });
  });

  it('시음 세션 키 — gsi1sk 는 <tastedAt>#<id>', () => {
    expect(tastingPk('t1')).toBe('TASTING#t1');
    expect(TASTING_META_SK).toBe('META');
    expect(tastingGsi1('2025-01-01T00:00:00Z', 't1')).toEqual({
      gsi1pk: 'TYPE#TASTING',
      gsi1sk: '2025-01-01T00:00:00Z#t1',
    });
  });

  it('녹음 sk — REC#<recId>', () => {
    expect(recordingSk('rec1')).toBe('REC#rec1');
    expect(isRecordingSk('REC#rec1')).toBe(true);
    expect(isRecordingSk('META')).toBe(false);
    expect(recordingIdFromSk('REC#rec1')).toBe('rec1');
    expect(recordingIdFromSk('META')).toBeUndefined();
  });

  it('분석 결과 sk', () => {
    expect(ANALYSIS_SK).toBe('ANALYSIS');
  });

  it('분석 작업 키 — gsi1pk 는 TYPE#JOB#<status>', () => {
    expect(JOB_SK).toBe('JOB');
    expect(jobGsi1('queued', '2025-01-01T00:00:00Z')).toEqual({
      gsi1pk: 'TYPE#JOB#queued',
      gsi1sk: '2025-01-01T00:00:00Z',
    });
  });

  it('취향 프로파일 — 싱글턴 키', () => {
    expect(PROFILE_PK).toBe('PROFILE');
    expect(PROFILE_SK).toBe('CURRENT');
  });

  it('발견 카드 키', () => {
    expect(discoveryPk('d1')).toBe('DISCOVERY#d1');
    expect(DISCOVERY_SK).toBe('META');
    expect(discoveryGsi1('2025-01-01T00:00:00Z', 'd1')).toEqual({
      gsi1pk: 'TYPE#DISCOVERY',
      gsi1sk: '2025-01-01T00:00:00Z#d1',
    });
  });

  it('속도 제한 카운터 키', () => {
    expect(ratePk('abc123')).toBe('RATE#abc123');
    expect(rateSk('2025-01-01T00:00')).toBe('2025-01-01T00:00');
  });
});

describe('parseKey — 역함수', () => {
  it('와인 META 를 파싱한다', () => {
    expect(parseKey('WINE#w1', 'META')).toEqual({ kind: 'WINE', id: 'w1' });
  });

  it('와이너리 META 를 파싱한다', () => {
    expect(parseKey('WINERY#wy1', 'META')).toEqual({ kind: 'WINERY', id: 'wy1' });
  });

  it('지역 META 를 파싱한다', () => {
    expect(parseKey('REGION#r1', 'META')).toEqual({ kind: 'REGION', id: 'r1' });
  });

  it('시음 세션 META 를 파싱한다', () => {
    expect(parseKey('TASTING#t1', 'META')).toEqual({ kind: 'TASTING', id: 't1' });
  });

  it('녹음(REC#) 을 파싱한다 — tastingId 와 recordingId 모두 복원', () => {
    expect(parseKey('TASTING#t1', 'REC#rec1')).toEqual({
      kind: 'RECORDING',
      id: 't1',
      recordingId: 'rec1',
    });
  });

  it('분석 결과를 파싱한다', () => {
    expect(parseKey('TASTING#t1', 'ANALYSIS')).toEqual({ kind: 'ANALYSIS', id: 't1' });
  });

  it('분석 작업을 파싱한다', () => {
    expect(parseKey('TASTING#t1', 'JOB')).toEqual({ kind: 'JOB', id: 't1' });
  });

  it('취향 프로파일을 파싱한다', () => {
    expect(parseKey('PROFILE', 'CURRENT')).toEqual({ kind: 'PROFILE' });
  });

  it('발견 카드를 파싱한다', () => {
    expect(parseKey('DISCOVERY#d1', 'META')).toEqual({ kind: 'DISCOVERY', id: 'd1' });
  });

  it('속도 제한 카운터를 파싱한다', () => {
    expect(parseKey('RATE#abc', '2025-01-01T00:00')).toEqual({
      kind: 'RATE',
      id: 'abc',
      window: '2025-01-01T00:00',
    });
  });

  it('알 수 없는 조합은 UNKNOWN', () => {
    expect(parseKey('FOO#1', 'BAR').kind).toBe('UNKNOWN');
    expect(parseKey('TASTING#t1', 'WEIRD').kind).toBe('UNKNOWN');
  });
});
