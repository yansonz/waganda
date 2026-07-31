/**
 * lib/agent/client.ts — Bedrock AgentCore Runtime `InvokeAgentRuntime` 래퍼 (9.6).
 *
 * design.md '재개 전략': 세션 ID는 두 호출(세션 A/B)에서 동일해야 하며
 * `waganda-tasting-<tastingId>-<env>` 형태로 결정론적으로 생성한다.
 * AgentCore 최소 세션 ID 길이 제약(33자)을 만족하지 못하면 패딩한다.
 *
 * AWS 실호출은 이 모듈에서 직접 하지 않고, 주입 가능한 invoker 를 통해서만 수행한다
 * (테스트에서 vi.fn() 등으로 스텁 가능하게 하기 위함 — design.md 규약).
 */
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import {
  AgentInvocationResult,
  MIN_RUNTIME_SESSION_ID_LENGTH,
  type AgentInvocation,
} from '@waganda/schemas';
import { getRuntimeConfig } from '@/lib/config';
import { assertExternalCallAllowed } from '@/lib/aws/testGuard';

/** 세션 ID 패딩에 쓰는 문자 — 식별에 방해되지 않는 안전한 문자 */
const PAD_CHAR = '0';

/**
 * `waganda-tasting-<tastingId>-<env>` 형태의 세션 ID를 생성한다.
 * 33자 미만이면 끝에 `PAD_CHAR` 를 채워 최소 길이를 보장한다.
 */
export function buildRuntimeSessionId(tastingId: string, env: string): string {
  const base = `waganda-tasting-${tastingId}-${env}`;
  if (base.length >= MIN_RUNTIME_SESSION_ID_LENGTH) {
    return base;
  }
  return base.padEnd(MIN_RUNTIME_SESSION_ID_LENGTH, PAD_CHAR);
}

/** 세션 ID가 AgentCore 제약(최소 33자)을 만족하는지 검증한다 */
export function assertValidRuntimeSessionId(sessionId: string): void {
  if (sessionId.length < MIN_RUNTIME_SESSION_ID_LENGTH) {
    throw new Error(
      `세션 ID 는 최소 ${MIN_RUNTIME_SESSION_ID_LENGTH}자 이상이어야 합니다 (현재 ${sessionId.length}자): ${sessionId}`,
    );
  }
}

/** AgentCore 호출 상한 — 서비스 기본값에 의존하지 않고 명시한다 (design.md '가드레일') */
export interface AgentInvocationLimits {
  maxIterations: number;
  timeoutSeconds: number;
  idleRuntimeSessionTimeout: number;
  maxLifetime: number;
}

export const DEFAULT_AGENT_LIMITS: AgentInvocationLimits = {
  maxIterations: 12,
  timeoutSeconds: 300,
  idleRuntimeSessionTimeout: 60,
  maxLifetime: 900,
};

/** 실제 AWS SDK 호출을 대신하는 주입 가능한 인터페이스 — 테스트에서 스텁으로 교체한다 */
export interface AgentRuntimeInvoker {
  invoke(params: {
    agentRuntimeArn: string;
    runtimeSessionId: string;
    payload: AgentInvocation;
    limits: AgentInvocationLimits;
  }): Promise<AgentInvocationResult>;
}

let invoker: AgentRuntimeInvoker | undefined;

/** 테스트 전용 — invoker 스텁을 주입한다 */
export function setAgentRuntimeInvoker(stub: AgentRuntimeInvoker): void {
  invoker = stub;
}

/** 테스트 전용 — 주입한 스텁을 해제한다 */
export function resetAgentRuntimeInvoker(): void {
  invoker = undefined;
}

/**
 * 실제 `InvokeAgentRuntime` 호출 구현.
 *
 * 주입된 스텁이 없으면 이것을 쓴다. 예전에는 기본 구현이 없어
 * "AgentRuntimeInvoker 가 설정되지 않았습니다" 로 즉시 실패했고, 프로덕션에서 주입하는
 * 코드도 없었다 — 즉 녹음 분석이 아예 시작되지 않았다.
 *
 * 테스트에서는 `assertExternalCallAllowed` 가 막으므로 실수로 실호출되지 않는다.
 */
function createRealInvoker(): AgentRuntimeInvoker {
  return {
    async invoke({ agentRuntimeArn, runtimeSessionId, payload }) {
      assertExternalCallAllowed('AgentCore InvokeAgentRuntime');

      const client = new BedrockAgentCoreClient({ region: getRuntimeConfig().region });
      const response = await client.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn,
          runtimeSessionId,
          // 런타임은 이 바이트를 그대로 컨테이너의 `POST /invocations` 본문으로 전달한다.
          payload: new TextEncoder().encode(JSON.stringify(payload)),
          contentType: 'application/json',
          accept: 'application/json',
        }),
      );

      const raw = response.response ? await collectResponseBody(response.response) : '';
      if (!raw) {
        throw new Error('AgentCore 응답이 비어 있습니다.');
      }

      const parsed: unknown = JSON.parse(raw);
      return AgentInvocationResult.parse(parsed);
    },
  };
}

/** SDK 응답 본문(스트림 또는 바이트)을 문자열로 모은다 */
async function collectResponseBody(body: unknown): Promise<string> {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);

  // SdkStream — transformToString 을 제공한다
  const maybeStream = body as { transformToString?: () => Promise<string> };
  if (typeof maybeStream.transformToString === 'function') {
    return await maybeStream.transformToString();
  }

  // 마지막 수단: async iterable 로 취급한다
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

/** 주입된 스텁이 있으면 그것을, 없으면 실제 구현을 쓴다 */
function getInvoker(): AgentRuntimeInvoker {
  if (invoker) return invoker;
  realInvoker ??= createRealInvoker();
  return realInvoker;
}

let realInvoker: AgentRuntimeInvoker | undefined;

/**
 * `InvokeAgentRuntime` 래퍼.
 *
 * - 세션 ID는 `tastingId`+env 기반으로 결정론적으로 생성해 세션 A/B 가 동일 세션을 공유한다.
 * - `agentRuntimeArn` 미설정 시 즉시 실패한다 (R1, R10 — 설정 없이 조용히 넘어가지 않음).
 */
export async function invokeAgentRuntime(
  tastingId: string,
  payload: AgentInvocation,
  limits: AgentInvocationLimits = DEFAULT_AGENT_LIMITS,
): Promise<AgentInvocationResult> {
  const config = getRuntimeConfig();
  if (!config.agentRuntimeArn) {
    throw new Error('설정 누락: WAGANDA_AGENT_RUNTIME_ARN 이 필요합니다.');
  }

  const runtimeSessionId = buildRuntimeSessionId(tastingId, config.env);
  assertValidRuntimeSessionId(runtimeSessionId);

  return getInvoker().invoke({
    agentRuntimeArn: config.agentRuntimeArn,
    runtimeSessionId,
    payload,
    limits,
  });
}
