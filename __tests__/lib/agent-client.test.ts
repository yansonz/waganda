import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_RUNTIME_SESSION_ID_LENGTH, type AgentInvocationResult } from '@waganda/schemas';
import {
  assertValidRuntimeSessionId,
  buildRuntimeSessionId,
  invokeAgentRuntime,
  resetAgentRuntimeInvoker,
  setAgentRuntimeInvoker,
  type AgentRuntimeInvoker,
} from '@/lib/agent/client';

describe('buildRuntimeSessionId', () => {
  it('waganda-tasting-<id>-<env> 형태로 생성한다 (33자 이상이 되도록 긴 tastingId 사용)', () => {
    const id = buildRuntimeSessionId('abc123-longer-id-value', 'dev');
    expect(id).toBe('waganda-tasting-abc123-longer-id-value-dev');
  });

  it('33자 미만이면 패딩해 최소 길이를 보장한다', () => {
    const id = buildRuntimeSessionId('t1', 'dev');
    expect(id.length).toBeGreaterThanOrEqual(MIN_RUNTIME_SESSION_ID_LENGTH);
    expect(id.startsWith('waganda-tasting-t1-dev')).toBe(true);
  });

  it('이미 33자 이상이면 패딩하지 않는다', () => {
    const longId = 'a'.repeat(40);
    const id = buildRuntimeSessionId(longId, 'dev');
    expect(id).toBe(`waganda-tasting-${longId}-dev`);
  });

  it('동일 입력에 대해 항상 같은 세션 ID를 생성한다 (세션 A/B 공유 근거)', () => {
    expect(buildRuntimeSessionId('t1', 'prod')).toBe(buildRuntimeSessionId('t1', 'prod'));
  });
});

describe('assertValidRuntimeSessionId', () => {
  it('33자 이상이면 통과한다', () => {
    expect(() => assertValidRuntimeSessionId('a'.repeat(33))).not.toThrow();
  });

  it('33자 미만이면 예외를 던진다', () => {
    expect(() => assertValidRuntimeSessionId('short-id')).toThrow(/최소.*33/);
  });
});

describe('invokeAgentRuntime — 주입된 invoker 를 통해서만 AWS 를 호출한다', () => {
  afterEach(() => {
    resetAgentRuntimeInvoker();
    delete process.env.WAGANDA_AGENT_RUNTIME_ARN;
  });

  it('agentRuntimeArn 미설정 시 즉시 실패한다', async () => {
    delete process.env.WAGANDA_AGENT_RUNTIME_ARN;
    await expect(
      invokeAgentRuntime('t1', { task: 'analyze_label', imageKey: 'k1' }),
    ).rejects.toThrow(/WAGANDA_AGENT_RUNTIME_ARN/);
  });

  it('설정되어 있으면 결정론적 세션 ID로 주입된 invoker 를 호출한다', async () => {
    process.env.WAGANDA_AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:test';
    const invoke = vi.fn(
      async (_params: {
        agentRuntimeArn: string;
        runtimeSessionId: string;
        payload: unknown;
        limits: {
          maxIterations: number;
          timeoutSeconds: number;
          idleRuntimeSessionTimeout: number;
          maxLifetime: number;
        };
      }): Promise<AgentInvocationResult> => ({
        ok: true,
        task: 'analyze_transcribed',
        completedSteps: [],
        skippedSteps: [],
      }),
    );
    const stub: AgentRuntimeInvoker = { invoke };
    setAgentRuntimeInvoker(stub);

    await invokeAgentRuntime('t1', {
      task: 'analyze_transcribed',
      tastingId: 't1',
      transcribeStatus: 'COMPLETED',
    });

    expect(invoke).toHaveBeenCalledOnce();
    const callArg = invoke.mock.calls[0][0];
    expect(callArg.runtimeSessionId.length).toBeGreaterThanOrEqual(MIN_RUNTIME_SESSION_ID_LENGTH);
    expect(callArg.runtimeSessionId).toContain('waganda-tasting-t1-');
    expect(callArg.limits.maxIterations).toBe(12);
  });

  it('invoker 가 주입되지 않으면 실패한다', async () => {
    process.env.WAGANDA_AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:test';
    resetAgentRuntimeInvoker();

    await expect(
      invokeAgentRuntime('t1', { task: 'analyze_label', imageKey: 'k1' }),
    ).rejects.toThrow(/AgentRuntimeInvoker/);
  });
});
