/**
 * 라벨 사진 업로드 전 준비(prepareLabelImage) 테스트.
 *
 * 배경: 아이폰 기본 포맷인 HEIC 는 라벨 인식 모델이 읽지 못한다.
 * 업로드 전에 JPEG 로 바꾸고, 브라우저가 HEIC 를 디코딩할 수 없으면
 * 무슨 일이 일어났는지 명확히 알려야 한다("네트워크 오류" 로 뭉개지 않는다).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_EDGE, prepareLabelImage } from '@/lib/upload/image';

/** createImageBitmap / canvas.toBlob 을 제어 가능한 스텁으로 대체한다 */
function stubImagePipeline(options: {
  decodable: boolean;
  width?: number;
  height?: number;
}): { drawn: { width: number; height: number }[] } {
  const drawn: { width: number; height: number }[] = [];

  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      if (!options.decodable) throw new Error('decode failed');
      return {
        width: options.width ?? 4000,
        height: options.height ?? 3000,
        close: vi.fn(),
      } as unknown as ImageBitmap;
    }),
  );

  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') {
      // 다른 태그는 원래 구현으로
      return Object.getPrototypeOf(document).createElement.call(document, tag);
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => {
          drawn.push({ width: w, height: h });
        },
      }),
      toBlob: (callback: BlobCallback) => {
        callback(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
      },
    };
    return canvas as unknown as HTMLElement;
  });

  return { drawn };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prepareLabelImage', () => {
  it('작은 JPEG 는 변환하지 않고 그대로 쓴다', async () => {
    const file = new File(['small'], 'label.jpg', { type: 'image/jpeg' });
    const result = await prepareLabelImage(file);

    expect(result).toMatchObject({ ok: true, converted: false });
    if (result.ok) expect(result.file).toBe(file);
  });

  it('HEIC 는 JPEG 로 변환한다 (디코딩 가능한 브라우저)', async () => {
    stubImagePipeline({ decodable: true });
    const file = new File(['heic-bytes'], 'IMG_0001.HEIC', { type: 'image/heic' });

    const result = await prepareLabelImage(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.converted).toBe(true);
      expect(result.file.type).toBe('image/jpeg');
      expect(result.file.name).toBe('IMG_0001.jpg');
    }
  });

  it('MIME 이 비어 있어도 확장자로 HEIC 를 알아본다', async () => {
    stubImagePipeline({ decodable: true });
    const file = new File(['heic-bytes'], 'test01_1.HEIC', { type: '' });

    const result = await prepareLabelImage(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.type).toBe('image/jpeg');
  });

  it('브라우저가 HEIC 을 디코딩하지 못하면 서버 변환으로 넘긴다', async () => {
    stubImagePipeline({ decodable: false });
    const file = new File(['heic-bytes'], 'IMG_0002.heic', { type: 'image/heic' });

    const converter = vi.fn(async () => ({
      ok: true as const,
      file: new File(['jpeg'], 'IMG_0002.jpg', { type: 'image/jpeg' }),
      converted: true,
    }));

    const result = await prepareLabelImage(file, converter);
    expect(converter).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.type).toBe('image/jpeg');
  });

  it('서버 변환까지 실패하면 원인과 대안을 알려준다', async () => {
    stubImagePipeline({ decodable: false });
    const file = new File(['heic-bytes'], 'IMG_0003.heic', { type: 'image/heic' });

    const converter = vi.fn(async () => ({
      ok: false as const,
      reason: '이 사진을 변환할 수 없습니다. JPEG 로 저장해 올려주세요.',
    }));

    const result = await prepareLabelImage(file, converter);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/JPEG/);
      // "네트워크 오류" 처럼 원인을 감추는 문구가 아니어야 한다
      expect(result.reason).not.toMatch(/네트워크 오류/);
    }
  });

  it('과대 해상도 사진은 긴 변을 상한까지 축소한다', async () => {
    const { drawn } = stubImagePipeline({ decodable: true, width: 4000, height: 3000 });
    const file = new File([new Uint8Array(5 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });

    const result = await prepareLabelImage(file);
    expect(result.ok).toBe(true);
    expect(drawn[0]).toEqual({ width: MAX_IMAGE_EDGE, height: (MAX_IMAGE_EDGE * 3000) / 4000 });
  });

  it('상한보다 작은 해상도는 확대하지 않는다', async () => {
    const { drawn } = stubImagePipeline({ decodable: true, width: 800, height: 600 });
    const file = new File([new Uint8Array(5 * 1024 * 1024)], 'medium.jpg', { type: 'image/jpeg' });

    await prepareLabelImage(file);
    expect(drawn[0]).toEqual({ width: 800, height: 600 });
  });
});
