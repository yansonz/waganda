/**
 * test/helpers/fakeAgent.ts — 모델 호출을 스텁하는 가짜 Agent.
 * `Agent.invoke()` 시그니처만 흉내내며, 실제 Strands `Agent` 인스턴스를 만들지
 * 않는다(BedrockModel 등 실제 자격증명 없이도 테스트가 동작해야 하므로).
 */
import type { Agent } from '@strands-agents/sdk';

/** invoke 호출마다 순차적으로 반환할 structuredOutput 목록을 받아 가짜 Agent 를 만든다 */
export function createFakeAgent(structuredOutputs: unknown[]): Agent {
  let callIndex = 0;
  const invoke = async () => {
    const output = structuredOutputs[Math.min(callIndex, structuredOutputs.length - 1)];
    callIndex += 1;
    return {
      type: 'agentResult',
      stopReason: 'end_turn',
      lastMessage: { type: 'message', role: 'assistant', content: [] },
      invocationState: {},
      structuredOutput: output,
    };
  };

  return { invoke } as unknown as Agent;
}
