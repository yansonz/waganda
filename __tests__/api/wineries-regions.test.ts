// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDocClient, setDocClient } from '@/lib/db/client';
import { resetCloudFrontInvalidator, setCloudFrontInvalidator } from '@/lib/cache/invalidate';
import { signEditorJWT, COOKIE_NAME } from '@/lib/auth/session';

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

const baseRegion = {
  id: 'r1',
  type: 'REGION',
  name: '피에몬테',
  nameNormalized: '피에몬테',
  level: 'region',
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

describe('POST /api/wineries', () => {
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

  it('미인증 요청은 401 을 반환한다', async () => {
    const { POST } = await import('@/app/api/wineries/route');
    const request = makeRequest('https://waganda.test/api/wineries', {
      method: 'POST',
      body: { name: '새 와이너리' },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('존재하지 않는 regionId 참조 시 거부한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({}); // getRegion → 없음

    const { POST } = await import('@/app/api/wineries/route');
    const request = makeRequest('https://waganda.test/api/wineries', {
      method: 'POST',
      body: { name: '새 와이너리', regionId: 'missing' },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('REFERENCE_INTEGRITY');
  });

  it('유효한 요청은 와이너리를 생성한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({}); // putWinery

    const { POST } = await import('@/app/api/wineries/route');
    const request = makeRequest('https://waganda.test/api/wineries', {
      method: 'POST',
      body: { name: '새 와이너리' },
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
  });
});

describe('DELETE /api/wineries/[id] — 역참조 검증', () => {
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
    const { DELETE } = await import('@/app/api/wineries/[id]/route');
    const request = makeRequest('https://waganda.test/api/wineries/wy1', { method: 'DELETE' });
    const response = await DELETE(request);
    expect(response.status).toBe(401);
  });

  it('연결된 와인이 있으면 삭제를 거부한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({
      Item: { ...baseWinery, pk: 'WINERY#wy1', sk: 'META' },
    }); // getWinery (라우트)
    mockClient.send.mockResolvedValueOnce({
      Item: { ...baseWinery, pk: 'WINERY#wy1', sk: 'META' },
    }); // getWinery (서비스)
    mockClient.send.mockResolvedValueOnce({
      Items: [
        {
          id: 'w1',
          type: 'WINE',
          name: 'w',
          nameNormalized: 'w',
          wineryId: 'wy1',
          grapes: [],
          labelTags: [],
          sourceUrls: [],
          schemaVersion: 2,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
          rev: 0,
          pk: 'WINE#w1',
          sk: 'META',
        },
      ],
    }); // scanAll

    const { DELETE } = await import('@/app/api/wineries/[id]/route');
    const request = makeRequest('https://waganda.test/api/wineries/wy1', { method: 'DELETE' });
    const response = await DELETE(request);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('BACKREFERENCE_EXISTS');
  });
});

describe('POST /api/regions', () => {
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

  it('미인증 요청은 401 을 반환한다', async () => {
    const { POST } = await import('@/app/api/regions/route');
    const request = makeRequest('https://waganda.test/api/regions', {
      method: 'POST',
      body: { name: '새 지역', level: 'region' },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('존재하지 않는 parentId 참조 시 거부한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({}); // getRegion(parentId) → 없음

    const { POST } = await import('@/app/api/regions/route');
    const request = makeRequest('https://waganda.test/api/regions', {
      method: 'POST',
      body: { name: '하위지역', level: 'subregion', parentId: 'missing' },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('유효한 요청은 지역을 생성한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({}); // putRegion

    const { POST } = await import('@/app/api/regions/route');
    const request = makeRequest('https://waganda.test/api/regions', {
      method: 'POST',
      body: { name: '새 지역', level: 'country' },
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
  });
});

describe('DELETE /api/regions/[id] — 역참조 검증', () => {
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
    const { DELETE } = await import('@/app/api/regions/[id]/route');
    const request = makeRequest('https://waganda.test/api/regions/r1', { method: 'DELETE' });
    const response = await DELETE(request);
    expect(response.status).toBe(401);
  });

  it('연결된 와이너리가 있으면 삭제를 거부한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({ Item: { ...baseRegion, pk: 'REGION#r1', sk: 'META' } }); // getRegion (라우트)
    mockClient.send.mockResolvedValueOnce({ Item: { ...baseRegion, pk: 'REGION#r1', sk: 'META' } }); // getRegion (서비스)
    mockClient.send.mockResolvedValueOnce({
      Items: [
        {
          id: 'wy1',
          type: 'WINERY',
          name: 'wy',
          nameNormalized: 'wy',
          regionId: 'r1',
          schemaVersion: 2,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
          rev: 0,
          pk: 'WINERY#wy1',
          sk: 'META',
        },
      ],
    }); // scanAll

    const { DELETE } = await import('@/app/api/regions/[id]/route');
    const request = makeRequest('https://waganda.test/api/regions/r1', { method: 'DELETE' });
    const response = await DELETE(request);
    expect(response.status).toBe(409);
  });
});
