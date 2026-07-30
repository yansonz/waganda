import type { SpeakerSegment, Transcript } from '@waganda/schemas';

/**
 * lib/analysis/transcript.ts — Amazon Transcribe 출력 파싱.
 *
 * Transcribe 는 단어 단위 항목과 화자분리(speaker_labels) 결과를 따로 준다.
 * 화면과 분석에 쓰기 좋은 형태(발화 단위 세그먼트)로 바꾸는 **순수 함수**다.
 * 화자 라벨은 `spk_0`/`spk_1` 로 오므로 내부 표기(`speaker_1`/`speaker_2`)로 정규화한다.
 */

/** Transcribe 결과 JSON 중 우리가 쓰는 부분만 (전체 스키마를 재현하지 않는다) */
export interface TranscribeOutput {
  results?: {
    transcripts?: { transcript?: string }[];
    speaker_labels?: {
      segments?: {
        speaker_label?: string;
        start_time?: string;
        end_time?: string;
      }[];
    };
    items?: {
      start_time?: string;
      end_time?: string;
      speaker_label?: string;
      alternatives?: { content?: string }[];
      type?: string;
    }[];
  };
}

/** `spk_0` → `speaker_1`. 화자가 3명 이상이면(설계상 2명 고정) 처음 둘만 인정한다 */
export function normalizeSpeakerLabel(label?: string): 'speaker_1' | 'speaker_2' | undefined {
  if (!label) return undefined;
  const match = label.match(/(\d+)$/);
  if (!match) return undefined;
  const index = Number(match[1]);
  if (index === 0) return 'speaker_1';
  if (index === 1) return 'speaker_2';
  return undefined;
}

/** 화자분리 구간 목록 — 화자 매핑(F0 비교)의 입력이 된다 */
export function toSpeakerSegments(output: TranscribeOutput): SpeakerSegment[] {
  const segments = output.results?.speaker_labels?.segments ?? [];
  const result: SpeakerSegment[] = [];

  for (const segment of segments) {
    const speaker = normalizeSpeakerLabel(segment.speaker_label);
    const start = Number(segment.start_time);
    const end = Number(segment.end_time);
    if (!speaker || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    result.push({ speaker, start, end });
  }

  return result;
}

/**
 * 단어 항목을 화자·시간 순으로 묶어 발화 단위 트랜스크립트를 만든다.
 * 화자가 바뀌거나 1.2초 이상 끊기면 새 세그먼트로 분리한다.
 */
export function toTranscript(output: TranscribeOutput, language = 'ko-KR'): Transcript {
  const fullText = output.results?.transcripts?.[0]?.transcript ?? '';
  const items = output.results?.items ?? [];

  const segments: Transcript['segments'] = [];
  const GAP_SEC = 1.2;

  for (const item of items) {
    const content = item.alternatives?.[0]?.content;
    if (!content) continue;

    // 구두점은 앞 세그먼트에 붙인다 (시간 정보가 없다)
    if (item.type === 'punctuation') {
      const last = segments.at(-1);
      if (last) last.text += content;
      continue;
    }

    const start = Number(item.start_time);
    const end = Number(item.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const speaker = normalizeSpeakerLabel(item.speaker_label);
    const last = segments.at(-1);
    const sameSpeaker = last?.speaker === speaker;
    const contiguous = last !== undefined && start - last.end <= GAP_SEC;

    if (last && sameSpeaker && contiguous) {
      last.text += ` ${content}`;
      last.end = end;
    } else {
      segments.push({ start, end, speaker, text: content });
    }
  }

  return {
    language,
    fullText: fullText || segments.map((s) => s.text).join(' '),
    segments,
  };
}

/** 트랜스크립트가 사실상 비어 있는지 (무음 녹음) — 실패로 처리하지 않고 해석 입력으로 쓴다 (R5) */
export function isEffectivelySilent(transcript: Transcript): boolean {
  return transcript.fullText.trim().length === 0 && transcript.segments.length === 0;
}
