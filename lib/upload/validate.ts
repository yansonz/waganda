/**
 * lib/upload/validate.ts — 녹음 업로드 검증 (7.2).
 *
 * 형식(mp3/m4a/wav/webm)·용량(50MB)·길이(10분)를 검증한다.
 * 위반 시 한국어 사유를 반환한다 (design.md '에러 처리' > R2).
 */
import {
  AudioFormat,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SEC,
  RecordingUploadRequest,
} from '@waganda/schemas';

/** 검증 실패 사유 코드 — 테스트·클라이언트 분기용 */
export type UploadValidationErrorCode = 'INVALID_FORMAT' | 'SIZE_EXCEEDED' | 'DURATION_EXCEEDED';

export interface UploadValidationResult {
  ok: boolean;
  /** 위반 사유 (한국어) — ok 가 true 면 undefined */
  reason?: string;
  code?: UploadValidationErrorCode;
}

const ALLOWED_FORMATS = AudioFormat.options;

function formatBytesAsMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function formatSecAsMin(sec: number): string {
  return (sec / 60).toFixed(1);
}

/**
 * 업로드 요청(형식·크기·길이)을 검증한다.
 * 여러 위반이 동시에 있어도 가장 먼저 발견된 것 하나만 보고한다(형식 → 크기 → 길이 순).
 */
export function validateAudioUpload(input: {
  format: string;
  sizeBytes: number;
  durationSec: number;
}): UploadValidationResult {
  const parsedFormat = AudioFormat.safeParse(input.format);
  if (!parsedFormat.success) {
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      reason: `지원하지 않는 오디오 형식입니다. 허용 형식: ${ALLOWED_FORMATS.join(', ')} (입력: ${input.format})`,
    };
  }

  if (input.sizeBytes > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      code: 'SIZE_EXCEEDED',
      reason: `파일 용량이 너무 큽니다. 최대 ${formatBytesAsMb(MAX_AUDIO_BYTES)}MB까지 업로드할 수 있습니다 (입력: ${formatBytesAsMb(input.sizeBytes)}MB).`,
    };
  }

  if (input.durationSec > MAX_AUDIO_SEC) {
    return {
      ok: false,
      code: 'DURATION_EXCEEDED',
      reason: `녹음 길이가 너무 길습니다. 최대 ${formatSecAsMin(MAX_AUDIO_SEC)}분까지 업로드할 수 있습니다 (입력: ${formatSecAsMin(input.durationSec)}분).`,
    };
  }

  return { ok: true };
}

/** RecordingUploadRequest 스키마 검증 + 업로드 제약(형식·크기·길이) 검증을 함께 수행한다 */
export function validateRecordingUploadRequest(
  body: unknown,
):
  | { ok: true; data: RecordingUploadRequest }
  | { ok: false; reason: string; code?: UploadValidationErrorCode } {
  const parsed = RecordingUploadRequest.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      reason: '요청 형식이 올바르지 않습니다. format/durationSec/sizeBytes 를 확인하세요.',
    };
  }

  const result = validateAudioUpload({
    format: parsed.data.format,
    sizeBytes: parsed.data.sizeBytes,
    durationSec: parsed.data.durationSec,
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason ?? '업로드 검증에 실패했습니다.', code: result.code };
  }

  return { ok: true, data: parsed.data };
}
