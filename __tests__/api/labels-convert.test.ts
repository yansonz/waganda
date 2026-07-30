// @vitest-environment node
/**
 * POST /api/labels/convert — HEIC → JPEG 변환 테스트.
 *
 * 아이폰 HEIC 은 라벨 인식 모델이 읽지 못하고 Chrome 계열은 디코딩도 못 한다.
 * 그래서 서버가 변환해 준다. 편집자 전용이며(CPU 사용), 실패 시 사유를 한국어로 알린다.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { COOKIE_NAME, signEditorJWT } from '@/lib/auth/session';
import { POST as convertLabel } from '@/app/api/labels/convert/route';
import { MAX_CONVERT_INPUT_BYTES } from '@/lib/upload/heic';

const BASE = 'https://waganda.test';
const cookieStore = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

async function makeRequest(
  body: Uint8Array,
  options: { authenticated?: boolean } = {},
): Promise<NextRequest> {
  cookieStore.clear();
  if (options.authenticated) {
    cookieStore.set(COOKIE_NAME, { value: await signEditorJWT('yan@example.com') });
  }
  return new NextRequest(`${BASE}/api/labels/convert`, {
    method: 'POST',
    headers: { 'content-type': 'image/heic', origin: BASE },
    body: body as unknown as BodyInit,
  });
}

/** 로컬에 실제 HEIC 샘플이 있으면 진짜 변환을 검증한다 (test-data/ 는 커밋되지 않는다) */
const SAMPLE = 'test-data/test01_1.HEIC';

describe('POST /api/labels/convert', () => {
  it('미인증 요청은 401 + loginUrl 을 반환한다', async () => {
    const response = await convertLabel(await makeRequest(new Uint8Array([1, 2, 3])));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string; loginUrl: string };
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.loginUrl).toContain('/api/auth/google/start');
  });

  it('빈 본문은 거부한다', async () => {
    const response = await convertLabel(
      await makeRequest(new Uint8Array(), { authenticated: true }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('EMPTY_BODY');
  });

  it('HEIC 이 아닌 데이터는 변환 실패 사유를 한국어로 알린다', async () => {
    const response = await convertLabel(
      await makeRequest(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), { authenticated: true }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('CONVERT_FAILED');
    expect(body.message).toMatch(/JPEG/);
  });

  it('용량 상한을 넘으면 거부한다', async () => {
    const response = await convertLabel(
      await makeRequest(new Uint8Array(MAX_CONVERT_INPUT_BYTES + 1), { authenticated: true }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('IMAGE_TOO_LARGE');
  });

  it.runIf(existsSync(SAMPLE))(
    '실제 HEIC 샘플을 JPEG 로 변환한다',
    async () => {
      const heic = new Uint8Array(readFileSync(SAMPLE));
      const response = await convertLabel(await makeRequest(heic, { authenticated: true }));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');

      const output = new Uint8Array(await response.arrayBuffer());
      // JPEG 매직 바이트
      expect(output[0]).toBe(0xff);
      expect(output[1]).toBe(0xd8);
      expect(output.byteLength).toBeGreaterThan(1024);
    },
    30_000,
  );
});
