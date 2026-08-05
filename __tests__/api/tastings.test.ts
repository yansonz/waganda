// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDocClient, setDocClient } from '@/lib/db/client';
import { resetCloudFrontInvalidator, setCloudFrontInvalidator } from '@/lib/cache/invalidate';
import { resetAgentRuntimeInvoker, setAgentRuntimeInvoker } from '@/lib/agent/client';
import { resetRecordingPresigner, setRecordingPresigner } from '@/lib/upload/presign';
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

const baseTasting = {
  id: 't1',
  type: 'TASTING',
  wineId: 'w1',
  tastedAt: '2025-01-01T12:00:00Z',
  schemaVersion: 2,
  createdAt: '2025-01-01T12:00:00Z',
  updatedAt: '2025-01-01T12:00:00Z',
  rev: 0,
};

const baseAnalysis = {
  type: 'ANALYSIS',
  tastingId: 't1',
  summary: '원본 AI 요약',
  highlights: [{ quote: '원본 인용', note: '원본 해석' }],
  aiRating: 4,
  notes: { acidity: 3, tannin: 3, body: 3, aroma: 3, finish: 3 },
  evidence: [],
  promptVersion: 'v1',
  modelId: 'model-1',
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

function recordingItem(recId: string) {
  return {
    id: recId,
    type: 'RECORDING',
    tastingId: 't1',
    audioKey: `recordings/t1/${recId}.mp3`,
    durationSec: 30,
    format: 'mp3',
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
    pk: 'TASTING#t1',
    sk: `REC#${recId}`,
  };
}

describe('POST /api/tastings', () => {
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
    const { POST } = await import('@/app/api/tastings/route');
    const request = makeRequest('https://waganda.test/api/tastings', {
      method: 'POST',
      body: { wineId: 'w1', tastedAt: '2025-01-01T00:00:00Z' },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.loginUrl).toBeDefined();
  });

  it('존재하지 않는 wineId 참조 시 거부한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({}); // getWine → 없음

    const { POST } = await import('@/app/api/tastings/route');
    const request = makeRequest('https://waganda.test/api/tastings', {
      method: 'POST',
      body: { wineId: 'missing', tastedAt: '2025-01-01T00:00:00Z' },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('REFERENCE_INTEGRITY');
  });

  it('유효한 wineId 면 시음 세션을 생성한다', async () => {
    await withEditorSession();
    const wineItem = {
      id: 'w1',
      type: 'WINE',
      name: 'Barolo 2018',
      nameNormalized: 'barolo 2018',
      grapes: [],
      labelTags: [],
      sourceUrls: [],
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
      pk: 'WINE#w1',
      sk: 'META',
    };
    mockClient.send.mockResolvedValueOnce({ Item: wineItem }); // getWine
    mockClient.send.mockResolvedValueOnce({}); // putTasting

    const { POST } = await import('@/app/api/tastings/route');
    const request = makeRequest('https://waganda.test/api/tastings', {
      method: 'POST',
      body: { wineId: 'w1', tastedAt: '2025-01-01T00:00:00Z' },
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tastingId).toBeDefined();
  });

  it('wineId 없이 녹음 우선 캡처를 생성한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({}); // putTasting

    const { POST } = await import('@/app/api/tastings/route');
    const request = makeRequest('https://waganda.test/api/tastings', {
      method: 'POST',
      body: { tastedAt: '2025-01-01T00:00:00Z' },
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = (await response.json()) as { tasting: Record<string, unknown> };
    expect(body.tasting).toMatchObject({ lifecycle: 'collecting' });
    expect(body.tasting).not.toHaveProperty('wineId');
    expect(mockClient.send).toHaveBeenCalledOnce();
  });
});

describe('GET /api/tastings/incomplete', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('미인증 요청은 401 을 반환한다', async () => {
    const { GET } = await import('@/app/api/tastings/incomplete/route');
    const response = await GET(makeRequest('https://waganda.test/api/tastings/incomplete'));

    expect(response.status).toBe(401);
  });
});

describe('POST /api/tastings/[id]/wine', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  beforeEach(() => {
    cookieStore.clear();
    mockClient = createMockDocClient();
    setDocClient(mockClient as never);
  });

  afterEach(() => {
    resetDocClient();
    vi.clearAllMocks();
  });

  it('미인증 요청은 401 을 반환한다', async () => {
    const { POST } = await import('@/app/api/tastings/[id]/wine/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/wine', {
      method: 'POST',
      body: { wineId: 'wine-1' },
    });

    expect((await POST(request)).status).toBe(401);
  });

  it('녹음이 있는 캡처에 와인을 연결하고 폴리싱 대기 상태로 전이한다', async () => {
    await withEditorSession();
    const wineItem = {
      id: 'wine-1',
      type: 'WINE',
      name: 'Barolo 2018',
      nameNormalized: 'barolo 2018',
      grapes: [],
      labelTags: [],
      sourceUrls: [],
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
      pk: 'WINE#wine-1',
      sk: 'META',
    };
    const capture = {
      ...baseTasting,
      wineId: undefined,
      lifecycle: 'collecting',
      pk: 'TASTING#t1',
      sk: 'META',
    };
    mockClient.send.mockResolvedValueOnce({ Item: capture }); // getTasting
    mockClient.send.mockResolvedValueOnce({ Item: wineItem }); // getWine
    mockClient.send.mockResolvedValueOnce({ Items: [recordingItem('r1')] }); // queryTastingBundle
    mockClient.send.mockResolvedValueOnce({
      Attributes: {
        ...baseTasting,
        wineId: 'wine-1',
        labelImageKey: 'labels/first.jpg',
        lifecycle: 'polishing',
        pk: 'TASTING#t1',
        sk: 'META',
      },
    }); // patchTasting

    const { POST } = await import('@/app/api/tastings/[id]/wine/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/wine', {
      method: 'POST',
      body: { wineId: 'wine-1', labelImageKey: 'labels/first.jpg' },
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        tasting: expect.objectContaining({ wineId: 'wine-1', lifecycle: 'polishing' }),
      }),
    );
  });
});

describe('PATCH /api/tastings/[id] — 원본 AI 생성물 보존', () => {
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
    const { PATCH } = await import('@/app/api/tastings/[id]/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1', {
      method: 'PATCH',
      body: { manualRating: 4, rev: 0 },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(401);
  });

  it('editedSummary 수정 시 원본 summary 는 patch 요청에 포함되지 않는다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({ Attributes: { ...baseTasting } }); // patchTasting
    mockClient.send.mockResolvedValueOnce({ Item: baseAnalysis }); // getAnalysis
    mockClient.send.mockResolvedValueOnce({
      Attributes: { ...baseAnalysis, editedSummary: '수정된 요약' },
    }); // patchAnalysis

    const { PATCH } = await import('@/app/api/tastings/[id]/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1', {
      method: 'PATCH',
      body: { editedSummary: '수정된 요약', rev: 0 },
    });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.analysis.editedSummary).toBe('수정된 요약');

    // patchAnalysis 호출에 원본 summary/highlights 가 없는지 확인
    const patchAnalysisCall = mockClient.send.mock.calls[2][0];
    expect(patchAnalysisCall.input.ExpressionAttributeNames).not.toContain('summary');
  });

  it('동시 갱신 충돌 시 409 를 반환한다', async () => {
    await withEditorSession();
    const conditionalError = Object.assign(new Error('conflict'), {
      name: 'ConditionalCheckFailedException',
    });
    mockClient.send.mockRejectedValueOnce(conditionalError);

    const { PATCH } = await import('@/app/api/tastings/[id]/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1', {
      method: 'PATCH',
      body: { manualRating: 4, rev: 5 },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(409);
  });
});

describe('POST /api/tastings/[id]/recordings — 업로드 검증 + 3개 제한', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  beforeEach(() => {
    cookieStore.clear();
    mockClient = createMockDocClient();
    setDocClient(mockClient as never);
    setRecordingPresigner({ presignPut: vi.fn(async () => 'https://s3.test/presigned-url') });
  });

  afterEach(() => {
    resetDocClient();
    resetRecordingPresigner();
    vi.clearAllMocks();
  });

  it('미인증 요청은 401 을 반환한다', async () => {
    const { POST } = await import('@/app/api/tastings/[id]/recordings/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/recordings', {
      method: 'POST',
      body: { format: 'mp3', durationSec: 60, sizeBytes: 1000 },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('허용하지 않는 형식은 한국어 사유와 함께 400 을 반환한다', async () => {
    await withEditorSession();
    const { POST } = await import('@/app/api/tastings/[id]/recordings/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/recordings', {
      method: 'POST',
      body: { format: 'ogg', durationSec: 60, sizeBytes: 1000 },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/[가-힣]/);
  });

  it('크기 초과는 한국어 사유와 함께 400 을 반환한다', async () => {
    await withEditorSession();
    const { POST } = await import('@/app/api/tastings/[id]/recordings/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/recordings', {
      method: 'POST',
      body: { format: 'mp3', durationSec: 60, sizeBytes: 60 * 1024 * 1024 },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('SIZE_EXCEEDED');
    expect(body.message).toMatch(/[가-힣]/);
  });

  it('길이 초과는 한국어 사유와 함께 400 을 반환한다', async () => {
    await withEditorSession();
    const { POST } = await import('@/app/api/tastings/[id]/recordings/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/recordings', {
      method: 'POST',
      body: { format: 'mp3', durationSec: 700, sizeBytes: 1000 },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('DURATION_EXCEEDED');
    expect(body.message).toMatch(/[가-힣]/);
  });

  it('0~2번째 녹음은 정상 등록된다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({
      Item: { ...baseTasting, pk: 'TASTING#t1', sk: 'META' },
    }); // getTasting
    mockClient.send.mockResolvedValueOnce({ Items: [recordingItem('r0'), recordingItem('r1')] }); // queryTastingBundle
    mockClient.send.mockResolvedValueOnce({}); // putRecording

    const { POST } = await import('@/app/api/tastings/[id]/recordings/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/recordings', {
      method: 'POST',
      body: { format: 'mp3', durationSec: 60, sizeBytes: 1000 },
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.uploadUrl).toBe('https://s3.test/presigned-url');
  });

  it('4번째 녹음 첨부는 거부한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({
      Item: { ...baseTasting, pk: 'TASTING#t1', sk: 'META' },
    }); // getTasting
    mockClient.send.mockResolvedValueOnce({
      Items: [recordingItem('r0'), recordingItem('r1'), recordingItem('r2')],
    }); // queryTastingBundle — 이미 3개

    const { POST } = await import('@/app/api/tastings/[id]/recordings/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/recordings', {
      method: 'POST',
      body: { format: 'mp3', durationSec: 60, sizeBytes: 1000 },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('RECORDING_LIMIT_EXCEEDED');
  });
});

describe('POST /api/tastings/[id]/analyze', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  beforeEach(() => {
    cookieStore.clear();
    mockClient = createMockDocClient();
    setDocClient(mockClient as never);
    process.env.WAGANDA_AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:test';
    setAgentRuntimeInvoker({
      invoke: vi.fn(async () => ({
        ok: true,
        task: 'analyze_transcribed',
        completedSteps: [],
        skippedSteps: [],
      })),
    });
  });

  afterEach(() => {
    resetDocClient();
    resetAgentRuntimeInvoker();
    delete process.env.WAGANDA_AGENT_RUNTIME_ARN;
    vi.clearAllMocks();
  });

  it('미인증 재분석 요청은 401 을 반환한다 (비용 보호)', async () => {
    const { POST } = await import('@/app/api/tastings/[id]/analyze/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/analyze', { method: 'POST' });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('인증된 요청은 작업을 큐에 올리고 에이전트를 호출한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({
      Item: { ...baseTasting, pk: 'TASTING#t1', sk: 'META' },
    }); // getTasting
    mockClient.send.mockResolvedValueOnce({}); // getJob → 없음
    mockClient.send.mockResolvedValueOnce({}); // putJob

    const { POST } = await import('@/app/api/tastings/[id]/analyze/route');
    const request = makeRequest('https://waganda.test/api/tastings/t1/analyze', { method: 'POST' });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobStatus).toBe('queued');
  });
});
