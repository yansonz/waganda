import { describe, expect, it } from 'vitest';
import { SERVICE_TIME_ZONE, deriveHourBucket, deriveWeekday } from '@/lib/domain/types';

/**
 * 요일·시간대 파생은 실행 환경의 로컬 시간대에 의존하면 안 된다.
 * 예전 구현은 `getHours()`/`getDay()` 를 써서 UTC 로 도는 CI·Lambda 에서 다른 버킷을 냈다
 * (KST 19:30 → UTC 10:30 → 'evening' 이 아니라 'dawn').
 */
describe('deriveHourBucket', () => {
  it('기준 시간대는 Asia/Seoul 이다', () => {
    expect(SERVICE_TIME_ZONE).toBe('Asia/Seoul');
  });

  it('UTC 로 저장된 시각도 서울 시각 기준으로 버킷을 정한다', () => {
    // 2024-01-15T10:30:00Z = 서울 19:30
    expect(deriveHourBucket('2024-01-15T10:30:00Z')).toBe('evening');
  });

  it('오프셋이 붙은 시각도 같은 순간이면 같은 버킷이다', () => {
    expect(deriveHourBucket('2024-01-15T19:30:00+09:00')).toBe('evening');
    expect(deriveHourBucket('2024-01-15T10:30:00Z')).toBe(
      deriveHourBucket('2024-01-15T19:30:00+09:00'),
    );
  });

  it('경계값을 버킷 정의대로 나눈다', () => {
    // 각 항목은 서울 시각 기준 05:00 / 10:59 / 11:00 / 13:59 / 14:00 / 17:59 / 18:00 / 21:59 / 22:00 / 04:59
    expect(deriveHourBucket('2024-01-14T20:00:00Z')).toBe('dawn'); // 05:00
    expect(deriveHourBucket('2024-01-15T01:59:00Z')).toBe('dawn'); // 10:59
    expect(deriveHourBucket('2024-01-15T02:00:00Z')).toBe('morning'); // 11:00
    expect(deriveHourBucket('2024-01-15T04:59:00Z')).toBe('morning'); // 13:59
    expect(deriveHourBucket('2024-01-15T05:00:00Z')).toBe('afternoon'); // 14:00
    expect(deriveHourBucket('2024-01-15T08:59:00Z')).toBe('afternoon'); // 17:59
    expect(deriveHourBucket('2024-01-15T09:00:00Z')).toBe('evening'); // 18:00
    expect(deriveHourBucket('2024-01-15T12:59:00Z')).toBe('evening'); // 21:59
    expect(deriveHourBucket('2024-01-15T13:00:00Z')).toBe('night'); // 22:00
    expect(deriveHourBucket('2024-01-15T19:59:00Z')).toBe('night'); // 04:59
  });

  it('자정 직후도 night 로 본다 (h23 파싱 확인)', () => {
    // 2024-01-15T15:00:00Z = 서울 다음날 00:00
    expect(deriveHourBucket('2024-01-15T15:00:00Z')).toBe('night');
  });

  it('해석할 수 없는 값은 조용히 넘기지 않는다', () => {
    expect(() => deriveHourBucket('언제인지 모름')).toThrow(/해석할 수 없습니다/);
  });
});

describe('deriveWeekday', () => {
  it('날짜가 서울 기준으로 넘어가는 시각을 올바른 요일로 센다', () => {
    // 2024-01-14T15:00:00Z(일) = 서울 2024-01-15 00:00 → 월요일(1)
    expect(deriveWeekday('2024-01-14T15:00:00Z')).toBe(1);
    // 2024-01-15T14:59:00Z = 서울 2024-01-15 23:59 → 여전히 월요일(1)
    expect(deriveWeekday('2024-01-15T14:59:00Z')).toBe(1);
    // 2024-01-15T15:00:00Z = 서울 2024-01-16 00:00 → 화요일(2)
    expect(deriveWeekday('2024-01-15T15:00:00Z')).toBe(2);
  });

  it('일요일은 0 이다', () => {
    expect(deriveWeekday('2024-01-14T03:00:00Z')).toBe(0);
  });
});
