// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDocClient, setDocClient } from '@/lib/db/client';
import { resetCloudFrontInvalidator, setCloudFrontInvalidator } from '@/lib/cache/invalidate';
import { signEditorJWT, COOKIE_NAME } from '@/lib/auth/session';

/**
 * app/api/wines/**, app/api/wineries/**, app/api/regions/** 통합 테스트.
 *
 * DynamoDB 는 `setDocClient` 스텁으로 대체한다 (AWS 실호출 금지 규약).
 * `next/headers` 의 cookies() 는 guard.test.ts 와 동일한 패턴으로 모킹한다.
 */

const cookieStore = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

function createMockDocClient() {
  return { send: vi.fn() };
}

function makeRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown },
): NextRequest {
  return new NextRequest(new URL(url, 'https://waganda.test'), {
    method: init?.method ?? 'GET',
    headers: {
      origin: 'https://waganda.test',
      'content-type': 'application/json',
      ...init?.headers,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function withEditorSession(): Promise<void> {
  const token = await signEditorJWT('yan@example.com');
  cookieStore.set(COOKIE_NAME, { value: token });
}

const baseWinery = {
  id: 'wy1',
  type: 'WINERY',
  name: '테스트 와이너리',
  nameNormalized: '테스트 와이너리',
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

const baseWine = {
  id: 'w1',
  type: 'WINE',
  name: 'Barolo 2018',
  nameNormalized: 'barolo 2018',
  vintage: 2018,
  wineryId: 'wy1',
  grapes: [],
  labelTags: [],
  sourceUrls: [],
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

describe('POST /api/wines', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  beforeEach(() => {
    cookieStore.clear();
    mockClient = createMockDocClient();
    setDocClient(mockClient as never);
    setCloudFrontInvalidator({ createInvalidation: vi.fn(async () => ({})) });
  });

  afterEach(() => {
    resetDocClient();
    resetCloudFrontInvalidator();
    vi.clearAllMocks();
  });

  it('미인증 요청은 401 과 loginUrl 을 반환한다', async () => {
    const { POST } = await import('@/app/api/wines/route');
    const request = makeRequest('https://waganda.test/api/wines', {
      method: 'POST',
      body: { name: '새 와인' },
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.loginUrl).toContain('/api/auth/google/start');
  });

  it('중복 조합(이름 일치) 등록 시도 시 후보를 반환하고 생성하지 않는다', async () => {
    await withEditorSession();
    // listByType('WINE') GSI1 쿼리 결과로 기존 와인을 반환
    mockClient.send.mockResolvedValueOnce({ Items: [{ ...baseWine, pk: 'WINE#w1', sk: 'META' }] });
    // getWinery 호출 (와이너리명 조회)
    mockClient.send.mockResolvedValueOnce({
      Item: { ...baseWinery, pk: 'WINERY#wy1', sk: 'META' },
    });
    // countTastingsForWine 의 scanAll
    mockClient.send.mockResolvedValueOnce({ Items: [] });

    const { POST } = await import('@/app/api/wines/route');
    const request = makeRequest('https://waganda.test/api/wines', {
      method: 'POST',
      body: { name: 'Barolo 2018', vintage: 2018, wineryId: 'wy1' },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.duplicateCandidates).toHaveLength(1);
    expect(body.duplicateCandidates[0].matchedOn).toEqual(['name', 'vintage', 'winery']);
  });

  it('존재하지 않는 wineryId 참조 시 거부한다', async () => {
    await withEditorSession();
    // listByType('WINE') — 중복 없음
    mockClient.send.mockResolvedValueOnce({ Items: [] });
    // getWinery — 존재하지 않음
    mockClient.send.mockResolvedValueOnce({});

    const { POST } = await import('@/app/api/wines/route');
    const request = makeRequest('https://waganda.test/api/wines', {
      method: 'POST',
      body: { name: '새 와인', wineryId: 'missing-winery' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('REFERENCE_INTEGRITY');
  });

  it('유효한 요청은 와인을 생성하고 캐시를 무효화한다', async () => {
    await withEditorSession();
    const invalidate = vi.fn(async () => ({}));
    setCloudFrontInvalidator({ createInvalidation: invalidate });
    process.env.WAGANDA_CF_DISTRIBUTION_ID = 'DIST1';

    mockClient.send.mockResolvedValueOnce({ Items: [] }); // listByType
    mockClient.send.mockResolvedValueOnce({}); // putWine

    const { POST } = await import('@/app/api/wines/route');
    const request = makeRequest('https://waganda.test/api/wines', {
      method: 'POST',
      body: { name: '새로운 와인' },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.wine.name).toBe('새로운 와인');
    expect(invalidate).toHaveBeenCalledOnce();

    delete process.env.WAGANDA_CF_DISTRIBUTION_ID;
  });
});

describe('PATCH /api/wines/[id]', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  beforeEach(() => {
    cookieStore.clear();
    mockClient = createMockDocClient();
    setDocClient(mockClient as never);
    setCloudFrontInvalidator({ createInvalidation: vi.fn(async () => ({})) });
  });

  afterEach(() => {
    resetDocClient();
    resetCloudFrontInvalidator();
    vi.clearAllMocks();
  });

  it('미인증 PATCH 는 401 을 반환한다', async () => {
    const { PATCH } = await import('@/app/api/wines/[id]/route');
    const request = makeRequest('https://waganda.test/api/wines/w1', {
      method: 'PATCH',
      body: { name: '변경', rev: 0 },
    });

    const response = await PATCH(request);
    expect(response.status).toBe(401);
  });

  it('동시 갱신 충돌(rev 불일치) 시 409 를 반환한다', async () => {
    await withEditorSession();
    const conditionalError = Object.assign(new Error('conflict'), {
      name: 'ConditionalCheckFailedException',
    });
    mockClient.send.mockRejectedValueOnce(conditionalError);

    const { PATCH } = await import('@/app/api/wines/[id]/route');
    const request = makeRequest('https://waganda.test/api/wines/w1', {
      method: 'PATCH',
      body: { name: '변경', rev: 5 },
    });

    const response = await PATCH(request);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('CONFLICT');
  });
});

describe('DELETE /api/wines/[id] — 역참조 검증', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  beforeEach(() => {
    cookieStore.clear();
    mockClient = createMockDocClient();
    setDocClient(mockClient as never);
    setCloudFrontInvalidator({ createInvalidation: vi.fn(async () => ({})) });
  });

  afterEach(() => {
    resetDocClient();
    resetCloudFrontInvalidator();
    vi.clearAllMocks();
  });

  it('미인증 DELETE 는 401 을 반환한다', async () => {
    const { DELETE } = await import('@/app/api/wines/[id]/route');
    const request = makeRequest('https://waganda.test/api/wines/w1', { method: 'DELETE' });
    const response = await DELETE(request);
    expect(response.status).toBe(401);
  });

  it('시음 기록이 있는 와인 삭제는 거부하고 연결 건수를 반환한다', async () => {
    await withEditorSession();
    const tastingBase = {
      type: 'TASTING',
      wineId: 'w1',
      tastedAt: '2025-01-01T00:00:00Z',
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    };
    mockClient.send.mockResolvedValueOnce({ Item: { ...baseWine, pk: 'WINE#w1', sk: 'META' } }); // getWine (라우트의 requireFound)
    mockClient.send.mockResolvedValueOnce({ Item: { ...baseWine, pk: 'WINE#w1', sk: 'META' } }); // getWine (deleteWine 내부)
    mockClient.send.mockResolvedValueOnce({
      Items: [
        { ...tastingBase, id: 't1', pk: 'TASTING#t1', sk: 'META' },
        { ...tastingBase, id: 't2', pk: 'TASTING#t2', sk: 'META' },
        { ...tastingBase, id: 't3', wineId: 'w2', pk: 'TASTING#t3', sk: 'META' },
      ],
    }); // scanAll

    const { DELETE } = await import('@/app/api/wines/[id]/route');
    const request = makeRequest('https://waganda.test/api/wines/w1', { method: 'DELETE' });
    const response = await DELETE(request);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('BACKREFERENCE_EXISTS');
    expect(body.count).toBe(2);
  });

  it('시음 기록이 없으면 삭제를 허용한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({ Item: { ...baseWine, pk: 'WINE#w1', sk: 'META' } }); // getWine (requireFound)
    mockClient.send.mockResolvedValueOnce({ Item: { ...baseWine, pk: 'WINE#w1', sk: 'META' } }); // getWine (deleteWine 내부)
    mockClient.send.mockResolvedValueOnce({ Items: [] }); // scanAll
    mockClient.send.mockResolvedValueOnce({}); // deleteWine

    const { DELETE } = await import('@/app/api/wines/[id]/route');
    const request = makeRequest('https://waganda.test/api/wines/w1', { method: 'DELETE' });
    const response = await DELETE(request);

    expect(response.status).toBe(200);
  });
});
