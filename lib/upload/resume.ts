/**
 * lib/upload/resume.ts — 업로드 실패 시 녹음 보존 및 재시도 (7.5).
 *
 * design.md '에러 처리': "업로드 중 네트워크 중단 → 브라우저에 녹음 보존, 재시도 버튼".
 * requirements.md R2: "네트워크 중단으로 업로드가 실패하면 녹음 데이터를 브라우저에
 * 보존하고 재시도 버튼을 제공한다".
 *
 * 구현 방식:
 * - Blob(오디오 원본)은 메모리(Map)에 보관한다. 페이지를 새로고침하면 Blob 자체는
 *   사라지지만, 재시도 버튼은 세션이 유지되는 동안(SPA 네비게이션)에는 항상 동작한다.
 * - 메타데이터(recordingId, uploadUrl, format, sizeBytes, durationSec, 상태, 시도 횟수)는
 *   `sessionStorage` 에 함께 저장해, 탭을 닫지 않는 한 새로고침에도 "무엇이 실패했는지"
 *   자체는 살아남게 한다 (Blob 은 세션 스토리지에 직렬화할 수 없으므로 메타만 보존).
 * - 새 npm 패키지를 설치하지 않는다 — IndexedDB 대신 메모리 Map + sessionStorage 메타로
 *   구현한다 (지시사항의 "메모리+sessionStorage 메타" 선택지).
 * - 지수 백오프로 자동 재시도하고, 자동 재시도가 모두 소진되면 수동 재시도 버튼을 통해
 *   언제든 다시 시도할 수 있게 한다.
 */

/** 업로드 항목의 현재 상태 */
export type UploadItemStatus = 'pending' | 'uploading' | 'failed' | 'succeeded';

/** sessionStorage 에 직렬화 가능한 메타데이터 (Blob 은 제외) */
export interface UploadItemMeta {
  /** 녹음 식별자 (서버가 발급) */
  recordingId: string;
  /** 사전 서명된 업로드 URL */
  uploadUrl: string;
  /** 오디오 형식 */
  format: string;
  /** 파일 크기(바이트) */
  sizeBytes: number;
  /** 녹음 길이(초) */
  durationSec: number;
  status: UploadItemStatus;
  /** 자동 재시도 횟수 (지수 백오프 계산에 사용) */
  attempts: number;
  /** 마지막 실패 사유 (한국어) */
  lastError?: string;
  updatedAt: string;
}

/** 메모리에만 보관하는 업로드 항목 (Blob 포함) — 페이지 생존 동안만 유효 */
interface UploadItemInMemory extends UploadItemMeta {
  blob: Blob;
}

/** sessionStorage 키 프리픽스 */
const STORAGE_PREFIX = 'waganda:upload-resume:';

/** 지수 백오프 기본 설정 */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_ATTEMPTS = 3;
export const BACKOFF_MAX_DELAY_MS = 30_000;

/** 재시도 지연(ms)을 계산한다. attempts 는 1부터 시작하는 시도 차수. */
export function computeBackoffDelayMs(attempts: number): number {
  const delay = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, BACKOFF_MAX_DELAY_MS);
}

/** 메모리 저장소 — Blob 은 직렬화할 수 없으므로 여기서만 관리한다 */
const memoryStore = new Map<string, UploadItemInMemory>();

function nowIso(): string {
  return new Date().toISOString();
}

function storageKey(recordingId: string): string {
  return `${STORAGE_PREFIX}${recordingId}`;
}

/** 메타데이터를 sessionStorage 에 저장한다. 사용 불가 환경에서는 조용히 무시한다. */
function persistMeta(meta: UploadItemMeta): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(meta.recordingId), JSON.stringify(meta));
  } catch {
    // sessionStorage 사용 불가(프라이버시 모드 등) — 메모리 상태만으로도 재시도는 동작한다.
  }
}

function removePersistedMeta(recordingId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(storageKey(recordingId));
  } catch {
    // 무시
  }
}

/** 업로드 대상을 등록한다(최초 1회). 이미 등록돼 있으면 메타를 갱신한다. */
export function registerUploadItem(input: {
  recordingId: string;
  uploadUrl: string;
  blob: Blob;
  format: string;
  sizeBytes: number;
  durationSec: number;
}): UploadItemMeta {
  const meta: UploadItemInMemory = {
    recordingId: input.recordingId,
    uploadUrl: input.uploadUrl,
    blob: input.blob,
    format: input.format,
    sizeBytes: input.sizeBytes,
    durationSec: input.durationSec,
    status: 'pending',
    attempts: 0,
    updatedAt: nowIso(),
  };
  memoryStore.set(input.recordingId, meta);
  persistMeta(toMeta(meta));
  return toMeta(meta);
}

function toMeta(item: UploadItemInMemory): UploadItemMeta {
  const { blob: _blob, ...meta } = item;
  return meta;
}

/** 등록된 업로드 항목의 메타데이터를 조회한다. */
export function getUploadItemMeta(recordingId: string): UploadItemMeta | undefined {
  const item = memoryStore.get(recordingId);
  return item ? toMeta(item) : undefined;
}

/** 현재 메모리에 남아 있는(= Blob 을 재전송할 수 있는) 모든 업로드 항목 메타를 반환한다. */
export function listUploadItems(): UploadItemMeta[] {
  return Array.from(memoryStore.values()).map(toMeta);
}

/** 업로드 완료 후 항목을 정리한다 (성공 시 더 이상 보존할 필요 없음). */
export function clearUploadItem(recordingId: string): void {
  memoryStore.delete(recordingId);
  removePersistedMeta(recordingId);
}

/** 실제 PUT 요청을 수행하는 인터페이스 — 테스트에서 주입해 네트워크를 모킹한다. */
export interface UploadTransport {
  putBlob(uploadUrl: string, blob: Blob, contentType: string): Promise<void>;
}

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

/** fetch 기반 기본 전송 구현 */
export const fetchUploadTransport: UploadTransport = {
  async putBlob(uploadUrl, blob, contentType) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!response.ok) {
      throw new Error(`업로드 실패 (HTTP ${response.status})`);
    }
  },
};

/** 실패 사유를 한국어 문자열로 정규화한다. */
function toKoreanErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `네트워크 오류로 업로드에 실패했습니다: ${error.message}`;
  }
  return '네트워크 오류로 업로드에 실패했습니다.';
}

/** 대기 헬퍼 — 테스트에서 타이머를 제어할 수 있도록 순수 setTimeout 사용 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface UploadAttemptResult {
  ok: boolean;
  meta: UploadItemMeta;
}

/**
 * 단일 업로드를 1회 시도한다. 성공하면 상태를 `succeeded` 로, 실패하면 `failed` 로
 * 갱신하고 시도 횟수를 증가시킨다. 항목이 등록되어 있지 않으면(Blob 소실) 실패로 처리한다.
 */
export async function attemptUpload(
  recordingId: string,
  transport: UploadTransport = fetchUploadTransport,
): Promise<UploadAttemptResult> {
  const item = memoryStore.get(recordingId);
  if (!item) {
    const meta: UploadItemMeta = {
      recordingId,
      uploadUrl: '',
      format: '',
      sizeBytes: 0,
      durationSec: 0,
      status: 'failed',
      attempts: 0,
      lastError: '보존된 녹음 데이터를 찾을 수 없습니다. 다시 녹음해 주세요.',
      updatedAt: nowIso(),
    };
    return { ok: false, meta };
  }

  item.status = 'uploading';
  item.updatedAt = nowIso();
  persistMeta(toMeta(item));

  try {
    const contentType = CONTENT_TYPE_BY_FORMAT[item.format] ?? 'application/octet-stream';
    await transport.putBlob(item.uploadUrl, item.blob, contentType);
    item.status = 'succeeded';
    item.lastError = undefined;
    item.updatedAt = nowIso();
    persistMeta(toMeta(item));
    return { ok: true, meta: toMeta(item) };
  } catch (error) {
    item.status = 'failed';
    item.attempts += 1;
    item.lastError = toKoreanErrorMessage(error);
    item.updatedAt = nowIso();
    persistMeta(toMeta(item));
    return { ok: false, meta: toMeta(item) };
  }
}

/**
 * 지수 백오프로 자동 재시도한다. `BACKOFF_MAX_ATTEMPTS` 회까지 자동으로 시도하고,
 * 모두 실패하면 마지막 실패 상태를 반환한다 — 이후에는 `attemptUpload` 를 수동 재시도
 * 버튼에서 직접 호출한다.
 */
export async function uploadWithBackoff(
  recordingId: string,
  transport: UploadTransport = fetchUploadTransport,
  options: { maxAttempts?: number; onAttempt?: (meta: UploadItemMeta) => void } = {},
): Promise<UploadAttemptResult> {
  const maxAttempts = options.maxAttempts ?? BACKOFF_MAX_ATTEMPTS;
  let result = await attemptUpload(recordingId, transport);
  options.onAttempt?.(result.meta);

  let attemptCount = 1;
  while (!result.ok && attemptCount < maxAttempts && memoryStore.has(recordingId)) {
    await delay(computeBackoffDelayMs(attemptCount));
    result = await attemptUpload(recordingId, transport);
    options.onAttempt?.(result.meta);
    attemptCount += 1;
  }

  return result;
}

/** 테스트 전용 — 모듈 전역 상태(메모리 Map)를 초기화한다. */
export function resetUploadResumeStateForTests(): void {
  memoryStore.clear();
}
