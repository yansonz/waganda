/**
 * Transcribe 출력 파싱 테스트 (lib/analysis/transcript.ts).
 *
 * Transcribe 는 단어 항목과 화자분리 결과를 따로 준다.
 * 화면·분석에 쓰는 발화 단위로 묶고, 화자 라벨(`spk_0`)을 내부 표기로 정규화한다.
 */
import { describe, expect, it } from 'vitest';
import {
  isEffectivelySilent,
  normalizeSpeakerLabel,
  toSpeakerSegments,
  toTranscript,
  type TranscribeOutput,
} from '@/lib/analysis/transcript';

const SAMPLE: TranscribeOutput = {
  results: {
    transcripts: [{ transcript: '이거 향이 좋다 응 나도 그렇게 생각해' }],
    speaker_labels: {
      segments: [
        { speaker_label: 'spk_0', start_time: '0.0', end_time: '2.5' },
        { speaker_label: 'spk_1', start_time: '2.6', end_time: '5.0' },
      ],
    },
    items: [
      { start_time: '0.1', end_time: '0.5', speaker_label: 'spk_0', type: 'pronunciation', alternatives: [{ content: '이거' }] },
      { start_time: '0.6', end_time: '1.0', speaker_label: 'spk_0', type: 'pronunciation', alternatives: [{ content: '향이' }] },
      { start_time: '1.1', end_time: '1.6', speaker_label: 'spk_0', type: 'pronunciation', alternatives: [{ content: '좋다' }] },
      { type: 'punctuation', alternatives: [{ content: '!' }] },
      { start_time: '3.0', end_time: '3.3', speaker_label: 'spk_1', type: 'pronunciation', alternatives: [{ content: '응' }] },
      { start_time: '3.4', end_time: '4.2', speaker_label: 'spk_1', type: 'pronunciation', alternatives: [{ content: '나도' }] },
    ],
  },
};

describe('normalizeSpeakerLabel', () => {
  it('spk_0 / spk_1 을 내부 표기로 바꾼다', () => {
    expect(normalizeSpeakerLabel('spk_0')).toBe('speaker_1');
    expect(normalizeSpeakerLabel('spk_1')).toBe('speaker_2');
  });

  it('설계상 2명 고정이므로 3번째 화자는 무시한다', () => {
    expect(normalizeSpeakerLabel('spk_2')).toBeUndefined();
  });

  it('라벨이 없거나 형식이 다르면 undefined', () => {
    expect(normalizeSpeakerLabel(undefined)).toBeUndefined();
    expect(normalizeSpeakerLabel('unknown')).toBeUndefined();
  });
});

describe('toSpeakerSegments', () => {
  it('화자분리 구간을 시간과 함께 뽑아낸다 (F0 매핑 입력)', () => {
    expect(toSpeakerSegments(SAMPLE)).toEqual([
      { speaker: 'speaker_1', start: 0, end: 2.5 },
      { speaker: 'speaker_2', start: 2.6, end: 5 },
    ]);
  });

  it('시간이 뒤집힌 구간은 버린다', () => {
    const broken: TranscribeOutput = {
      results: {
        speaker_labels: {
          segments: [{ speaker_label: 'spk_0', start_time: '5.0', end_time: '1.0' }],
        },
      },
    };
    expect(toSpeakerSegments(broken)).toEqual([]);
  });

  it('화자분리 결과가 없으면 빈 배열 (화자 매핑은 none 이 된다)', () => {
    expect(toSpeakerSegments({ results: {} })).toEqual([]);
  });
});

describe('toTranscript', () => {
  it('같은 화자의 연속 발화를 하나의 세그먼트로 묶는다', () => {
    const transcript = toTranscript(SAMPLE);
    expect(transcript.segments).toHaveLength(2);
    expect(transcript.segments[0]).toMatchObject({
      speaker: 'speaker_1',
      start: 0.1,
      text: '이거 향이 좋다!',
    });
    expect(transcript.segments[1]).toMatchObject({ speaker: 'speaker_2', text: '응 나도' });
  });

  it('구두점은 앞 발화에 붙인다', () => {
    expect(toTranscript(SAMPLE).segments[0].text.endsWith('!')).toBe(true);
  });

  it('화자가 바뀌면 세그먼트를 분리한다', () => {
    const transcript = toTranscript(SAMPLE);
    expect(transcript.segments.map((s) => s.speaker)).toEqual(['speaker_1', 'speaker_2']);
  });

  it('1.2초 이상 끊기면 같은 화자라도 분리한다', () => {
    const gapped: TranscribeOutput = {
      results: {
        items: [
          { start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0', type: 'pronunciation', alternatives: [{ content: '음' }] },
          { start_time: '3.0', end_time: '3.5', speaker_label: 'spk_0', type: 'pronunciation', alternatives: [{ content: '좋네' }] },
        ],
      },
    };
    expect(toTranscript(gapped).segments).toHaveLength(2);
  });

  it('언어 코드를 기록한다 (기본 ko-KR)', () => {
    expect(toTranscript(SAMPLE).language).toBe('ko-KR');
  });

  it('무음 녹음은 빈 트랜스크립트가 되고 실패로 취급하지 않는다', () => {
    const silent = toTranscript({ results: { transcripts: [{ transcript: '' }], items: [] } });
    expect(silent.segments).toEqual([]);
    expect(isEffectivelySilent(silent)).toBe(true);
  });

  it('발화가 있으면 무음이 아니다', () => {
    expect(isEffectivelySilent(toTranscript(SAMPLE))).toBe(false);
  });
});
