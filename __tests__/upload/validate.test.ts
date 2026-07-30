import { describe, expect, it } from 'vitest';
import { MAX_AUDIO_BYTES, MAX_AUDIO_SEC } from '@waganda/schemas';
import { validateAudioUpload, validateRecordingUploadRequest } from '@/lib/upload/validate';

describe('validateAudioUpload — 형식·크기·길이 검증', () => {
  it('허용 형식(mp3/m4a/wav/webm)은 통과한다', () => {
    for (const format of ['mp3', 'm4a', 'wav', 'webm']) {
      const result = validateAudioUpload({ format, sizeBytes: 1000, durationSec: 60 });
      expect(result.ok).toBe(true);
    }
  });

  it('허용하지 않는 형식은 한국어 사유와 함께 거부한다', () => {
    const result = validateAudioUpload({ format: 'ogg', sizeBytes: 1000, durationSec: 60 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_FORMAT');
    expect(result.reason).toContain('지원하지 않는 오디오 형식');
    expect(result.reason).toMatch(/[가-힣]/);
  });

  it('50MB 초과 시 한국어 사유와 함께 거부한다', () => {
    const result = validateAudioUpload({
      format: 'mp3',
      sizeBytes: MAX_AUDIO_BYTES + 1,
      durationSec: 60,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SIZE_EXCEEDED');
    expect(result.reason).toContain('용량');
    expect(result.reason).toMatch(/[가-힣]/);
  });

  it('50MB 이하는 통과한다', () => {
    const result = validateAudioUpload({
      format: 'mp3',
      sizeBytes: MAX_AUDIO_BYTES,
      durationSec: 60,
    });
    expect(result.ok).toBe(true);
  });

  it('10분 초과 시 한국어 사유와 함께 거부한다', () => {
    const result = validateAudioUpload({
      format: 'mp3',
      sizeBytes: 1000,
      durationSec: MAX_AUDIO_SEC + 1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DURATION_EXCEEDED');
    expect(result.reason).toContain('길이');
    expect(result.reason).toMatch(/[가-힣]/);
  });

  it('10분 이하는 통과한다', () => {
    const result = validateAudioUpload({
      format: 'mp3',
      sizeBytes: 1000,
      durationSec: MAX_AUDIO_SEC,
    });
    expect(result.ok).toBe(true);
  });

  it('형식 위반이 크기·길이 위반보다 먼저 보고된다', () => {
    const result = validateAudioUpload({
      format: 'ogg',
      sizeBytes: MAX_AUDIO_BYTES + 1,
      durationSec: MAX_AUDIO_SEC + 1,
    });
    expect(result.code).toBe('INVALID_FORMAT');
  });
});

describe('validateRecordingUploadRequest', () => {
  it('유효한 요청은 파싱된 데이터를 반환한다', () => {
    const result = validateRecordingUploadRequest({
      format: 'mp3',
      durationSec: 60,
      sizeBytes: 1000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.format).toBe('mp3');
    }
  });

  it('스키마 자체가 위반되면(필드 누락) 거부한다', () => {
    const result = validateRecordingUploadRequest({ format: 'mp3' });
    expect(result.ok).toBe(false);
  });

  it('길이 위반 시 한국어 사유를 포함해 거부한다', () => {
    const result = validateRecordingUploadRequest({
      format: 'wav',
      durationSec: MAX_AUDIO_SEC + 100,
      sizeBytes: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/[가-힣]/);
      expect(result.code).toBe('DURATION_EXCEEDED');
    }
  });
});
