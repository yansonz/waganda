// @vitest-environment node
/**
 * POST /api/tastings/[id]/analyze — 분석 트리거 분기 테스트.
 *
 * - 배포 환경: AgentCore Runtime 호출
 * - 로컬(`WAGANDA_LOCAL_PIPELINE=1`): 로컬 파이프라인을 백그라운드로 실행
 * - 둘 다 없으면: 설정 누락을 명확히 알린다 (500 스택이 아니라 사유)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CURRENT_SCHEMA_VERSION } from '@waganda/schemas';
import { COOKIE_NAME, signEditorJWT } from '@/lib/auth/session';
import { resetDocClient, setDocClient } from '@/lib/db/client';
import {
  resetAgentRuntimeInvoker,
  setAgentRuntimeInvoker,
  type AgentRuntimeInvoker,
} from '@/lib/agent/client';

const BASE = 'https://waganda.test';
const TASTING_ID = 'tasting-1';

const cookieStore = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieStore.get(name),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

/** 로컬 파이프라인 모듈을 스텁으로 대체한다 (실제 AWS 호출 금지) */
const runLocalAnalysis = vi.fn(async () => ({
  tastingId: TASTING_ID,
  aiRating: 4,
  highlightCount: 2,
  mappingConfidence: 'none',
  summary: '요약',
}));

vi.mock('@/lib/analysis/localPipeline', () => ({ runLocalAnalysis }));

const now = new Date().toISOString();
const meta = { schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: now, updatedAt: now, rev: 0 };

/** 시음은 있고 작업은 없는 상태를 흉내낸다 */
function stubDb() {
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const name = command.constructor.name;
    const input = command.input as { Key?: { sk?: string } };

    if (name === 'GetCommand') {
      if (input.Key?.sk === 'META') {
        return {
          Item: { type: 'TASTING', id: TASTING_ID, wineId: 'wine-1', tastedAt: now, ...meta },
        };
      }
      return { Item: undefined }; // JOB 없음
    }
    return {};
  });

  setDocClient({ send } as unknown as Parameters<typeof setDocClient>[0]);
  return send;
}

async function makeRequest(): Promise<NextRequest> {
  cookieStore.clear();
  cookieStore.set(COOKIE_NAME, { value: await signEditorJWT('yan@example.com') });
  return new NextRequest(`${BASE}/api/tastings/${TASTING_ID}/analyze`, {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  stubDb();
  runLocalAnalysis.mockClear();
  delete process.env.WAGANDA_AGENT_RUNTIME_ARN;
  delete process.env.WAGANDA_LOCAL_PIPELINE;
});

afterEach(() => {
  resetDocClient();
  resetAgentRuntimeInvoker();
  delete process.env.WAGANDA_AGENT_RUNTIME_ARN;
  delete process.env.WAGANDA_LOCAL_PIPELINE;
});

describe('분석 트리거', () => {
  it('AgentCore 가 설정돼 있으면 에이전트를 호출한다 (로컬 파이프라인 미사용)', async () => {
    process.env.WAGANDA_AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:test';
    const invoke: AgentRuntimeInvoker['invoke'] = vi.fn(async () => ({
      ok: true,
      task: 'analyze_transcribed',
      completedSteps: [],
      skippedSteps: [],
    }));
    setAgentRuntimeInvoker({ invoke });

    const { POST } = await import('@/app/api/tastings/[id]/analyze/route');
    const response = await POST(await makeRequest());

    expect(response.status).toBe(200);
    expect(invoke).toHaveBeenCalledOnce();
    expect(runLocalAnalysis).not.toHaveBeenCalled();
  });

  it('로컬 설정이면 파이프라인을 실행하고 즉시 응답한다', async () => {
    process.env.WAGANDA_LOCAL_PIPELINE = '1';

    const { POST } = await import('@/app/api/tastings/[id]/analyze/route');
    const response = await POST(await makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobStatus: string; tastingId: string };
    expect(body.jobStatus).toBe('queued');
    expect(body.tastingId).toBe(TASTING_ID);

    // 백그라운드 실행이므로 응답 이후에 호출된다
    await vi.waitFor(() => expect(runLocalAnalysis).toHaveBeenCalledOnce());
  });

  it('백그라운드 실행이 실패해도 응답은 성공이다 (녹음은 이미 저장돼 있다)', async () => {
    process.env.WAGANDA_LOCAL_PIPELINE = '1';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    runLocalAnalysis.mockRejectedValueOnce(new Error('transcribe down'));

    const { POST } = await import('@/app/api/tastings/[id]/analyze/route');
    const response = await POST(await makeRequest());

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    error.mockRestore();
  });

  it('둘 다 설정되지 않으면 설정 누락을 알린다', async () => {
    const { POST } = await import('@/app/api/tastings/[id]/analyze/route');
    const response = await POST(await makeRequest());

    expect(response.ok).toBe(false);
    expect(runLocalAnalysis).not.toHaveBeenCalled();
  });

  it('미인증 요청은 401 이고 아무 것도 실행하지 않는다 (비용 보호)', async () => {
    process.env.WAGANDA_LOCAL_PIPELINE = '1';
    cookieStore.clear();

    const { POST } = await import('@/app/api/tastings/[id]/analyze/route');
    const response = await POST(
      new NextRequest(`${BASE}/api/tastings/${TASTING_ID}/analyze`, {
        method: 'POST',
        headers: { origin: BASE, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(runLocalAnalysis).not.toHaveBeenCalled();
  });
});
