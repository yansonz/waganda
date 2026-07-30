import convert from 'heic-convert';

/**
 * lib/upload/heic.ts — HEIC/HEIF → JPEG 변환.
 *
 * 아이폰 기본 촬영 포맷은 HEIC 인데 (1) 라벨 인식 모델은 JPEG·PNG·WEBP 만 읽고
 * (2) Chrome 계열 브라우저는 HEIC 를 디코딩하지 못한다. 그래서 서버가 변환한다.
 */

/** 변환 입력 크기 상한 (25MB) — 휴대폰 원본 사진 여유분 */
export const MAX_CONVERT_INPUT_BYTES = 25 * 1024 * 1024;

/** 출력 품질 — 라벨을 읽는 데 충분하고 업로드·모델 입력 크기를 억제하는 값 */
const OUTPUT_QUALITY = 0.6;

export type HeicConvertResult =
  /** 표준 Response 본문으로 바로 넘길 수 있는 ArrayBuffer */
  | { ok: true; jpeg: ArrayBuffer }
  | { ok: false; code: 'EMPTY_BODY' | 'IMAGE_TOO_LARGE' | 'CONVERT_FAILED'; message: string };

/** HEIC 바이트를 JPEG 로 변환한다 */
export async function convertHeicToJpeg(buffer: Buffer): Promise<HeicConvertResult> {
  if (buffer.byteLength === 0) {
    return { ok: false, code: 'EMPTY_BODY', message: '변환할 사진 데이터가 없습니다.' };
  }

  if (buffer.byteLength > MAX_CONVERT_INPUT_BYTES) {
    return {
      ok: false,
      code: 'IMAGE_TOO_LARGE',
      message: `사진 용량이 너무 큽니다. ${Math.floor(MAX_CONVERT_INPUT_BYTES / (1024 * 1024))}MB 이하로 올려주세요.`,
    };
  }

  try {
    const jpeg = await convert({ buffer, format: 'JPEG', quality: OUTPUT_QUALITY });
    const bytes = Buffer.from(jpeg);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return { ok: true, jpeg: arrayBuffer };
  } catch {
    return {
      ok: false,
      code: 'CONVERT_FAILED',
      message: '이 사진을 변환할 수 없습니다. JPEG 로 저장해 올려주세요.',
    };
  }
}
