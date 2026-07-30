/**
 * lib/upload/image.ts — 라벨 사진 업로드 전 브라우저 측 준비.
 *
 * 왜 필요한가:
 * 1. 아이폰 기본 촬영 포맷은 HEIC 인데, 라벨 인식에 쓰는 멀티모달 모델은
 *    JPEG·PNG·WEBP 만 읽는다. 그래서 업로드 전에 JPEG 로 바꿔야 한다.
 * 2. 원본 사진은 수 MB~수십 MB 다. 라벨을 읽는 데 그만한 해상도가 필요 없고,
 *    업로드 시간과 저장 비용만 늘어난다. 긴 변 기준으로 축소한다.
 *
 * HEIC 디코딩은 브라우저에 달려 있다(Safari 는 가능, Chrome 은 대체로 불가).
 * 디코딩이 안 되면 변환 실패를 명확히 알려 사용자가 JPEG 로 다시 올리게 한다.
 */

/** 라벨 인식에 충분한 긴 변 최대 길이(px) */
export const MAX_IMAGE_EDGE = 2000;

/** 업로드에 사용할 형식 */
const OUTPUT_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.85;

export type PrepareImageResult =
  | { ok: true; file: File; converted: boolean }
  | { ok: false; reason: string };

/** 이미 업로드 가능한 형식인지 */
function isDirectlyUploadable(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}

function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type.includes('heic') || type.includes('heif')) return true;
  // macOS·Windows 파일 선택기는 HEIC 의 MIME 을 비워 보내는 경우가 있다
  return /\.(heic|heif)$/i.test(file.name);
}

/**
 * 업로드용 파일을 준비한다.
 * - 지원 형식이고 충분히 작으면 그대로 쓴다.
 * - 과대 해상도면 캔버스로 축소해 JPEG 로 다시 인코딩한다.
 * - HEIC 는 브라우저가 디코딩하지 못하는 경우가 많아 `convertOnServer` 로 위임한다.
 *
 * @param convertOnServer HEIC 을 JPEG 로 바꿔 주는 함수 (기본은 `/api/labels/convert` 호출)
 */
export async function prepareLabelImage(
  file: File,
  convertOnServer: HeicConverter = defaultHeicConverter,
): Promise<PrepareImageResult> {
  // HEIC 은 먼저 브라우저 디코딩을 시도하고, 실패하면 서버 변환으로 넘어간다.
  if (isHeic(file)) {
    const decoded = await tryCanvasReencode(file);
    if (decoded.ok) return decoded;

    const converted = await convertOnServer(file);
    if (!converted.ok) return converted;
    // 변환된 JPEG 이 여전히 크면 캔버스로 축소한다
    const shrunk = await tryCanvasReencode(converted.file);
    return shrunk.ok ? { ok: true, file: shrunk.file, converted: true } : converted;
  }

  const needsConversion = !isDirectlyUploadable(file.type);

  // 변환이 필요 없고 크기도 적당하면 원본 사용
  if (!needsConversion && file.size <= 4 * 1024 * 1024) {
    return { ok: true, file, converted: false };
  }

  const reencoded = await tryCanvasReencode(file);
  if (reencoded.ok) return reencoded;
  return needsConversion
    ? reencoded
    : { ok: true, file, converted: false };
}

/** HEIC 을 JPEG 로 바꾸는 함수 계약 (테스트에서 주입 가능) */
export type HeicConverter = (file: File) => Promise<PrepareImageResult>;

/** 기본 구현 — 서버의 변환 엔드포인트를 호출한다 */
async function defaultHeicConverter(file: File): Promise<PrepareImageResult> {
  try {
    const response = await fetch('/api/labels/convert', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'image/heic' },
      body: file,
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { ok: false, reason: '로그인이 필요합니다.' };
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      return {
        ok: false,
        reason: body.message ?? 'HEIC 사진을 변환하지 못했습니다. JPEG 로 저장해 올려주세요.',
      };
    }

    const blob = await response.blob();
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'label';
    return {
      ok: true,
      file: new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }),
      converted: true,
    };
  } catch {
    return { ok: false, reason: '사진 변환 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

/** 캔버스로 디코딩·축소해 JPEG 로 다시 인코딩한다 (디코딩 불가 시 실패) */
async function tryCanvasReencode(file: File): Promise<PrepareImageResult> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { ok: false, reason: '이 브라우저에서는 사진을 변환할 수 없습니다.' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: '이 브라우저에서 사진을 열 수 없습니다.' };
  }

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return { ok: false, reason: '사진을 변환할 수 없습니다.' };
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY);
  });
  if (!blob) {
    return { ok: false, reason: '사진을 변환할 수 없습니다.' };
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'label';
  return {
    ok: true,
    file: new File([blob], `${baseName}.jpg`, { type: OUTPUT_TYPE }),
    converted: true,
  };
}
