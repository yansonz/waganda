/**
 * lib/domain/speaker.ts 테스트 — 화자 매핑 gap 경계, 단일 화자, F0 결측
 */
import { describe, expect, it } from 'vitest';
import type { F0Point, SpeakerSegment } from '@waganda/schemas';
import { mapSpeakers } from '@/lib/domain/speaker';

/** 균일한 F0 값을 가진 구간의 트랙 포인트를 생성한다 */
function trackFor(segments: { start: number; end: number; hz: number }[]): F0Point[] {
  const points: F0Point[] = [];
  for (const seg of segments) {
    for (let t = seg.start; t <= seg.end; t += 0.1) {
      points.push({ t, hz: seg.hz });
    }
  }
  return points;
}

describe('mapSpeakers', () => {
  it('gap >= 60Hz 이면 낮은 쪽 yan, 높은 쪽 robert, confidence high', () => {
    // speaker_1 100Hz, speaker_2 160Hz → gap 60
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const f0Track = trackFor([
      { start: 0, end: 1, hz: 100 },
      { start: 2, end: 3, hz: 160 },
    ]);

    const result = mapSpeakers(f0Track, segments);

    expect(result.mappingConfidence).toBe('high');
    expect(result.mapping).toEqual({ speaker_1: 'yan', speaker_2: 'robert' });
    expect(result.medianF0?.gapHz).toBeCloseTo(60, 0);
  });

  it('gap 45Hz (30<=gap<60) 이면 동일 매핑, confidence medium', () => {
    // speaker_1 100Hz, speaker_2 145Hz → gap 45
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const f0Track = trackFor([
      { start: 0, end: 1, hz: 100 },
      { start: 2, end: 3, hz: 145 },
    ]);

    const result = mapSpeakers(f0Track, segments);

    expect(result.mappingConfidence).toBe('medium');
    expect(result.mapping).toEqual({ speaker_1: 'yan', speaker_2: 'robert' });
  });

  it('gap 29Hz (< 30) 이면 매핑 없음(null), confidence none', () => {
    // speaker_1 100Hz, speaker_2 129Hz → gap 29
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const f0Track = trackFor([
      { start: 0, end: 1, hz: 100 },
      { start: 2, end: 3, hz: 129 },
    ]);

    const result = mapSpeakers(f0Track, segments);

    expect(result.mappingConfidence).toBe('none');
    expect(result.mapping).toBeNull();
  });

  it('gap 정확히 60Hz 경계 — high 판정 (gap >= 60)', () => {
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const f0Track = trackFor([
      { start: 0, end: 1, hz: 100 },
      { start: 2, end: 3, hz: 160 },
    ]);
    const result = mapSpeakers(f0Track, segments);
    expect(result.mappingConfidence).toBe('high');
  });

  it('gap 정확히 30Hz 경계 — medium 판정 (30 <= gap < 60)', () => {
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const f0Track = trackFor([
      { start: 0, end: 1, hz: 100 },
      { start: 2, end: 3, hz: 130 },
    ]);
    const result = mapSpeakers(f0Track, segments);
    expect(result.mappingConfidence).toBe('medium');
  });

  it('단일 화자만 존재하면 매핑 없음 + confidence none', () => {
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_1', start: 2, end: 3 },
    ];
    const f0Track = trackFor([{ start: 0, end: 3, hz: 120 }]);

    const result = mapSpeakers(f0Track, segments);

    expect(result.mapping).toBeNull();
    expect(result.mappingConfidence).toBe('none');
  });

  it('F0 결측(무성 프레임만 존재)이면 매핑 없음 + confidence none', () => {
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    // 전부 hz=0 무성 프레임 → 표본 없음
    const f0Track = trackFor([
      { start: 0, end: 1, hz: 0 },
      { start: 2, end: 3, hz: 0 },
    ]);

    const result = mapSpeakers(f0Track, segments);

    expect(result.mapping).toBeNull();
    expect(result.mappingConfidence).toBe('none');
    expect(result.medianF0?.speaker_1).toBeNull();
    expect(result.medianF0?.speaker_2).toBeNull();
  });

  it('한쪽 화자만 F0 결측이어도 매핑 없음 + confidence none', () => {
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const f0Track = [
      ...trackFor([{ start: 0, end: 1, hz: 0 }]), // speaker_1 무성
      ...trackFor([{ start: 2, end: 3, hz: 150 }]), // speaker_2 유성
    ];

    const result = mapSpeakers(f0Track, segments);

    expect(result.mapping).toBeNull();
    expect(result.mappingConfidence).toBe('none');
  });

  it('F0 트랙이 완전히 비어있으면 매핑 없음 + confidence none', () => {
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const result = mapSpeakers([], segments);

    expect(result.mapping).toBeNull();
    expect(result.mappingConfidence).toBe('none');
  });

  it('speaker_2 가 더 낮은 F0 일 때도 낮은 쪽이 yan 이 된다', () => {
    const segments: SpeakerSegment[] = [
      { speaker: 'speaker_1', start: 0, end: 1 },
      { speaker: 'speaker_2', start: 2, end: 3 },
    ];
    const f0Track = trackFor([
      { start: 0, end: 1, hz: 180 }, // speaker_1 높음
      { start: 2, end: 3, hz: 100 }, // speaker_2 낮음
    ]);

    const result = mapSpeakers(f0Track, segments);

    expect(result.mappingConfidence).toBe('high');
    expect(result.mapping).toEqual({ speaker_1: 'robert', speaker_2: 'yan' });
  });
});
