import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attemptUpload,
  clearUploadItem,
  computeBackoffDelayMs,
  getUploadItemMeta,
  listUploadItems,
  registerUploadItem,
  resetUploadResumeStateForTests,
  uploadWithBackoff,
  type UploadTransport,
} from '@/lib/upload/resume';

/**
 * lib/upload/resume.ts 테스트 (7.5).
 *
 * 업로드 실패 시 녹음(Blob)이 메모리에 보존되고, sessionStorage 에 메타데이터가
 * 함께 저장되는지, 지수 백오프 재시도와 수동 재시도가 올바르게 동작하는지 검증한다.
 */

function makeBlob(): Blob {
  return new Blob(['fake-audio'], { type: 'audio/webm' });
}

describe('computeBackoffDelayMs', () => {
  it('시도 차수에 따라 지수적으로 증가한다', () => {
    expect(computeBackoffDelayMs(1)).toBe(1000);
    expect(computeBackoffDelayMs(2)).toBe(2000);
    expect(computeBackoffDelayMs(3)).toBe(4000);
  });

  it('최대 지연 시간을 넘지 않는다', () => {
    expect(computeBackoffDelayMs(10)).toBeLessThanOrEqual(30_000);
  });
});

describe('registerUploadItem / getUploadItemMeta / listUploadItems', () => {
  beforeEach(() => {
    resetUploadResumeStateForTests();
    sessionStorage.clear();
  });

  it('등록한 항목을 조회할 수 있다', () => {
    registerUploadItem({
      recordingId: 'rec-1',
      uploadUrl: 'https://example.com/upload',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 100,
      durationSec: 12,
    });

    const meta = getUploadItemMeta('rec-1');
    expect(meta?.status).toBe('pending');
    expect(meta?.format).toBe('webm');
  });

  it('sessionStorage 에 메타데이터를 보존한다(Blob 은 제외)', () => {
    registerUploadItem({
      recordingId: 'rec-2',
      uploadUrl: 'https://example.com/upload',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 100,
      durationSec: 12,
    });

    const raw = sessionStorage.getItem('waganda:upload-resume:rec-2');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.recordingId).toBe('rec-2');
    expect(parsed.blob).toBeUndefined();
  });

  it('삭제하면 목록과 sessionStorage 에서 모두 제거된다', () => {
    registerUploadItem({
      recordingId: 'rec-3',
      uploadUrl: 'https://example.com/upload',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 100,
      durationSec: 12,
    });
    clearUploadItem('rec-3');

    expect(getUploadItemMeta('rec-3')).toBeUndefined();
    expect(sessionStorage.getItem('waganda:upload-resume:rec-3')).toBeNull();
  });
});

describe('attemptUpload', () => {
  beforeEach(() => {
    resetUploadResumeStateForTests();
    sessionStorage.clear();
  });

  it('전송이 성공하면 상태가 succeeded 로 바뀐다', async () => {
    registerUploadItem({
      recordingId: 'rec-ok',
      uploadUrl: 'https://example.com/upload',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 100,
      durationSec: 12,
    });

    const transport: UploadTransport = { putBlob: vi.fn().mockResolvedValue(undefined) };
    const result = await attemptUpload('rec-ok', transport);

    expect(result.ok).toBe(true);
    expect(result.meta.status).toBe('succeeded');
  });

  it('전송이 실패하면 한국어 사유와 함께 failed 상태가 된다', async () => {
    registerUploadItem({
      recordingId: 'rec-fail',
      uploadUrl: 'https://example.com/upload',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 100,
      durationSec: 12,
    });

    const transport: UploadTransport = {
      putBlob: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const result = await attemptUpload('rec-fail', transport);

    expect(result.ok).toBe(false);
    expect(result.meta.status).toBe('failed');
    expect(result.meta.lastError).toMatch(/[가-힣]/);
    expect(result.meta.attempts).toBe(1);
  });

  it('등록되지 않은(Blob 소실) 항목은 실패로 처리하고 한국어 안내를 제공한다', async () => {
    const result = await attemptUpload('missing-rec');
    expect(result.ok).toBe(false);
    expect(result.meta.lastError).toMatch(/[가-힣]/);
  });
});

describe('uploadWithBackoff — 실패 후 재시도 UI 동작 지원', () => {
  beforeEach(() => {
    resetUploadResumeStateForTests();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('실패 후 자동 재시도하다 성공하면 최종 결과가 succeeded 이다', async () => {
    registerUploadItem({
      recordingId: 'rec-retry',
      uploadUrl: 'https://example.com/upload',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 100,
      durationSec: 12,
    });

    let callCount = 0;
    const transport: UploadTransport = {
      putBlob: vi.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount < 2) {
          throw new Error('일시적 오류');
        }
      }),
    };

    const onAttempt = vi.fn();
    const resultPromise = uploadWithBackoff('rec-retry', transport, { onAttempt });

    // 지수 백오프 타이머를 진행시킨다.
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
    expect(onAttempt).toHaveBeenCalled();
  });

  it('최대 시도 횟수까지 모두 실패하면 failed 상태로 남고 수동 재시도가 가능하다', async () => {
    registerUploadItem({
      recordingId: 'rec-give-up',
      uploadUrl: 'https://example.com/upload',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 100,
      durationSec: 12,
    });

    const transport: UploadTransport = {
      putBlob: vi.fn().mockRejectedValue(new Error('계속 실패')),
    };

    const resultPromise = uploadWithBackoff('rec-give-up', transport, { maxAttempts: 2 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.meta.status).toBe('failed');

    // 수동 재시도 — attemptUpload 를 직접 호출해도 여전히 Blob 이 보존되어 있어 동작한다.
    const okTransport: UploadTransport = { putBlob: vi.fn().mockResolvedValue(undefined) };
    const manualRetry = await attemptUpload('rec-give-up', okTransport);
    expect(manualRetry.ok).toBe(true);
  });
});

describe('listUploadItems', () => {
  beforeEach(() => {
    resetUploadResumeStateForTests();
  });

  it('여러 항목을 등록하면 모두 조회된다', () => {
    registerUploadItem({
      recordingId: 'a',
      uploadUrl: 'u',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 1,
      durationSec: 1,
    });
    registerUploadItem({
      recordingId: 'b',
      uploadUrl: 'u',
      blob: makeBlob(),
      format: 'webm',
      sizeBytes: 1,
      durationSec: 1,
    });

    expect(listUploadItems()).toHaveLength(2);
  });
});
