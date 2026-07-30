/**
 * agents/discovery.ts — 패턴 발견 에이전트 (R8).
 *
 * 등급(strong/moderate/weak) 판정은 `lib/domain/discovery.ts` 의 `gradeDiscovery`
 * (결정론적 코드)가 전담한다. 이 에이전트는 `DiscoveryCandidate` 형태의 후보만
 * 제시하고, 등급 필드를 직접 채우지 않는다.
 */
import { Agent, type Model } from '@strands-agents/sdk';
import { z } from 'zod';
import { DiscoveryCandidate } from '@waganda/schemas';
import type { Repository } from '@app/db/repository';
import { buildReadonlyTools } from '../tools/index.js';
import { DISCOVERY_PROMPT_VERSION, DISCOVERY_SYSTEM_PROMPT } from '../prompts/discovery.js';

/** 발견 에이전트 출력 — 후보 목록 (등급은 이후 코드가 판정) */
export const DiscoveryAgentOutput = z.object({
  candidates: z.array(DiscoveryCandidate).max(10),
});
export type DiscoveryAgentOutput = z.infer<typeof DiscoveryAgentOutput>;

export interface CreateDiscoveryAgentOptions {
  model: Model;
  repo: Repository;
}

export function createDiscoveryAgent(options: CreateDiscoveryAgentOptions): Agent {
  return new Agent({
    id: 'discovery',
    name: '패턴 발견',
    description: '정통/비전통 축을 탐색해 뜻밖의 패턴 후보를 제시한다',
    model: options.model,
    systemPrompt: DISCOVERY_SYSTEM_PROMPT,
    tools: buildReadonlyTools({ repo: options.repo }),
    structuredOutputSchema: DiscoveryAgentOutput,
    printer: false,
  });
}

export { DISCOVERY_PROMPT_VERSION };
