// @vitest-environment node
/**
 * POST /api/labels/upload — 라벨 사진 사전 서명 업로드 테스트.
 *
 * 라벨 인식은 S3 객체를 읽으므로 업로드가 선행되어야 한다.
 * 저장 공간·모델 호출 비용 보호를 위해 편집자 가드가 걸려 있다 (R1, R10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as uploadLabel } from '@/app/api/labels/upload/route';
import {
  MAX_LABEL_IMAGE_BYTES,
  resetRecordingPresigner,
  setRecordingPresigner,
} from '@/lib/upload/presign';
import { signEditorJWT, COOKIE_NAME } from '@/lib/auth/session';

const BASE = 'https://waganda.test';

/** next/headers 의 cookies() 를 요청 스코프 밖에서도 쓸 수 있게 모킹한다 */
const cookieStore = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

async function makeRequest(
  body: unknown,
  options: { authenticated?: boolean; origin?: string } = {},
): Promise<NextRequest> {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: options.origin ?? BASE,
  });
  cookieStore.clear();
  if (options.authenticated) {
    const token = await signEditorJWT('yan@example.com');
    cookieStore.set(COOKIE_NAME, { value: token });
  }
  return new NextRequest(`${BASE}/api/labels/upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  setRecordingPresigner({
    presignPut: async ({ bucket, key }) => `https://s3.test/${bucket}/${key}?signed=1`,
  });
});

afterEach(() => {
  resetRecordingPresigner();
  vi.restoreAllMocks();
});

describe('POST /api/labels/upload', () => {
  it('미인증 요청은 401 + loginUrl 을 반환한다', async () => {
    const response = await uploadLabel(
      await makeRequest({ contentType: 'image/jpeg', sizeBytes: 1024 }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string; loginUrl: string };
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.loginUrl).toContain('/api/auth/google/start');
  });

  it('편집자는 labels/ 프리픽스 키와 업로드 URL 을 받는다', async () => {
    const response = await uploadLabel(
      await makeRequest({ contentType: 'image/jpeg', sizeBytes: 2048 }, { authenticated: true }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { imageKey: string; uploadUrl: string };
    expect(body.imageKey).toMatch(/^labels\/.+\.jpg$/);
    expect(body.uploadUrl).toContain('signed=1');
  });

  it('지원하지 않는 형식은 한국어 사유로 거부한다', async () => {
    const response = await uploadLabel(
      await makeRequest({ contentType: 'application/pdf', sizeBytes: 2048 }, { authenticated: true }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(body.message).toMatch(/지원하지 않는 이미지 형식/);
  });

  it('용량 상한을 넘으면 한국어 사유로 거부한다', async () => {
    const response = await uploadLabel(
      await makeRequest(
        { contentType: 'image/jpeg', sizeBytes: MAX_LABEL_IMAGE_BYTES + 1 },
        { authenticated: true },
      ),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('IMAGE_TOO_LARGE');
    expect(body.message).toMatch(/용량이 너무 큽니다/);
  });

  it('잘못된 Origin 의 요청은 거부한다 (CSRF 방어)', async () => {
    const response = await uploadLabel(
      await makeRequest(
        { contentType: 'image/jpeg', sizeBytes: 2048 },
        { authenticated: true, origin: 'https://evil.example.com' },
      ),
    );
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });

  it('heic·png·webp 도 허용한다 (휴대폰 촬영 대응)', async () => {
    for (const [contentType, ext] of [
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['image/heic', 'heic'],
    ] as const) {
      const response = await uploadLabel(
        await makeRequest({ contentType, sizeBytes: 1024 }, { authenticated: true }),
      );
      expect(response.status, contentType).toBe(200);
      const body = (await response.json()) as { imageKey: string };
      expect(body.imageKey.endsWith(`.${ext}`), contentType).toBe(true);
    }
  });
});
