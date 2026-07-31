// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDocClient, setDocClient } from '@/lib/db/client';
import { resetCloudFrontInvalidator, setCloudFrontInvalidator } from '@/lib/cache/invalidate';
import { resetAgentRuntimeInvoker, setAgentRuntimeInvoker } from '@/lib/agent/client';
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

const baseDiscovery = {
  id: 'd1',
  type: 'DISCOVERY',
  groupBy: 'grape',
  key: 'nebbiolo',
  alias: '네비올로 마니아',
  description: '패턴 서술',
  metric: 'meanRating',
  n: 6,
  value: 4.5,
  deltaVsOverall: 1.2,
  grade: 'strong',
  evidenceTastingIds: [],
  disclaimer: '표본이 적어 우연일 수 있습니다. 기록이 쌓이면 다시 판정합니다.',
  hidden: false,
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

describe('PATCH /api/discoveries/[id]/hide', () => {
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
    const { PATCH } = await import('@/app/api/discoveries/[id]/hide/route');
    const request = makeRequest('https://waganda.test/api/discoveries/d1/hide', {
      method: 'PATCH',
      body: { rev: 0 },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(401);
  });

  it('인증된 요청은 카드를 숨김 처리한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({
      Item: { ...baseDiscovery, pk: 'DISCOVERY#d1', sk: 'META' },
    }); // getDiscovery
    mockClient.send.mockResolvedValueOnce({
      Attributes: { ...baseDiscovery, hidden: true, rev: 1 },
    }); // patchDiscovery

    const { PATCH } = await import('@/app/api/discoveries/[id]/hide/route');
    const request = makeRequest('https://waganda.test/api/discoveries/d1/hide', {
      method: 'PATCH',
      body: { rev: 0 },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.discovery.hidden).toBe(true);
  });

  it('존재하지 않는 카드면 404 를 반환한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({}); // getDiscovery → 없음

    const { PATCH } = await import('@/app/api/discoveries/[id]/hide/route');
    const request = makeRequest('https://waganda.test/api/discoveries/missing/hide', {
      method: 'PATCH',
      body: { rev: 0 },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(404);
  });
});

describe('POST /api/labels/analyze — 편집자 가드 필수 (모델 호출 비용 보호)', () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.WAGANDA_AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:test';
  });

  afterEach(() => {
    resetAgentRuntimeInvoker();
    delete process.env.WAGANDA_AGENT_RUNTIME_ARN;
    vi.clearAllMocks();
  });

  it('미인증 요청은 401 을 반환하고 에이전트를 호출하지 않는다 (비용 보호 회귀 방지)', async () => {
    const invoke = vi.fn();
    setAgentRuntimeInvoker({ invoke });

    const { POST } = await import('@/app/api/labels/analyze/route');
    const request = makeRequest('https://waganda.test/api/labels/analyze', {
      method: 'POST',
      body: { imageKey: 'labels/img1.jpg' },
    });
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('라벨 인식은 이미지를 읽어 Bedrock 을 직접 호출한다 (에이전트 경로는 이미지를 전달하지 못한다)', async () => {
    await withEditorSession();

    /*
     * AgentCore 의 라벨 에이전트는 프롬프트에 S3 키를 문자열로만 넘겨 모델이 이미지를
     * 볼 수 없다(항상 `recognized: false`). 그래서 런타임 ARN 이 설정돼 있어도
     * 라벨 인식은 에이전트를 호출하지 않고 Bedrock 을 직접 부른다.
     */
    process.env.WAGANDA_AGENT_RUNTIME_ARN =
      'arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:runtime/test-abc';
    const invoke = vi.fn();
    setAgentRuntimeInvoker({ invoke });

    // 이미지 조회·모델 호출은 주입으로 대체한다(요금 발생 호출을 테스트에서 하지 않는다).
    const { setLabelDirectDeps } = await import('@/lib/agent/labelDirect');
    setLabelDirectDeps({
      readImage: async () => new Uint8Array([1, 2, 3]),
      // 모델은 JSON 문자열을 돌려준다(스키마 검증은 labelDirect 가 수행한다).
      invokeModel: async () =>
        JSON.stringify({
          recognized: true,
          name: { value: 'Château Test', confidence: 'high' },
          sourceUrls: [],
        }),
    });

    const { POST } = await import('@/app/api/labels/analyze/route');
    const response = await POST(
      makeRequest('https://waganda.test/api/labels/analyze', {
        method: 'POST',
        body: { imageKey: 'labels/img1.jpg' },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      label?: { name?: { value?: string } };
      via?: string;
    };
    expect(body.via).toBe('bedrock-direct');
    expect(body.label?.name?.value).toBe('Château Test');
    // 에이전트 런타임은 호출되지 않아야 한다.
    expect(invoke).not.toHaveBeenCalled();

    setLabelDirectDeps(undefined);
  });
});

describe('PATCH /api/recordings/[id]/speakers — 화자 매핑 교체', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  const recordingWithSpeakers = {
    id: 'rec1',
    type: 'RECORDING',
    tastingId: 't1',
    audioKey: 'a.mp3',
    durationSec: 60,
    format: 'mp3',
    speakers: {
      segments: [],
      mapping: { speaker_1: 'yan', speaker_2: 'robert' },
      mappingConfidence: 'high',
      manuallyOverridden: false,
    },
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
  };

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
    const { PATCH } = await import('@/app/api/recordings/[id]/speakers/route');
    const request = makeRequest('https://waganda.test/api/recordings/rec1/speakers', {
      method: 'PATCH',
      body: { tastingId: 't1', rev: 0, mapping: { speaker_1: 'robert', speaker_2: 'yan' } },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(401);
  });

  it('인증된 요청은 화자 매핑을 교체한다', async () => {
    await withEditorSession();
    mockClient.send.mockResolvedValueOnce({
      Item: { ...recordingWithSpeakers, pk: 'TASTING#t1', sk: 'REC#rec1' },
    }); // getRecording (라우트)
    mockClient.send.mockResolvedValueOnce({
      Item: { ...recordingWithSpeakers, pk: 'TASTING#t1', sk: 'REC#rec1' },
    }); // getRecording (서비스 내부)
    mockClient.send.mockResolvedValueOnce({
      Attributes: {
        ...recordingWithSpeakers,
        speakers: {
          ...recordingWithSpeakers.speakers,
          mapping: { speaker_1: 'robert', speaker_2: 'yan' },
          manuallyOverridden: true,
        },
      },
    }); // patchRecording

    const { PATCH } = await import('@/app/api/recordings/[id]/speakers/route');
    const request = makeRequest('https://waganda.test/api/recordings/rec1/speakers', {
      method: 'PATCH',
      body: { tastingId: 't1', rev: 0, mapping: { speaker_1: 'robert', speaker_2: 'yan' } },
    });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recording.speakers.mapping).toEqual({ speaker_1: 'robert', speaker_2: 'yan' });
    expect(body.recording.speakers.manuallyOverridden).toBe(true);
  });
});
