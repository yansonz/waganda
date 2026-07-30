/**
 * agents/sommelier.ts — 소믈리에 에이전트 (R6).
 *
 * ReAct 스타일로 도구를 자율 선택해 시음 분석을 생성한다. 이 파일은 Strands
 * `Agent` 를 얇게 감싸며, 모델은 `createSommelierAgent(model, ...)` 로 주입
 * 가능하게 한다 — 테스트에서는 가짜 모델(고정 응답)을 넣어 결정론적으로
 * 검증한다.
 */
import { Agent, type Model } from '@strands-agents/sdk';
import { SommelierOutput } from '@waganda/schemas';
import type { Repository } from '@app/db/repository';
import { buildReadonlyTools } from '../tools/index.js';
import { SOMMELIER_PROMPT_VERSION, SOMMELIER_SYSTEM_PROMPT } from '../prompts/sommelier.js';

export interface CreateSommelierAgentOptions {
  /** 주입 가능한 모델 — 프로덕션에서는 BedrockModel, 테스트에서는 가짜 모델 */
  model: Model;
  repo: Repository;
}

/** 소믈리에 에이전트 인스턴스를 만든다. 출력은 `SommelierOutput` 스키마로 강제한다 */
export function createSommelierAgent(options: CreateSommelierAgentOptions): Agent {
  return new Agent({
    id: 'sommelier',
    name: '소믈리에',
    description: '시음 트랜스크립트·음향 특징을 근거로 요약·평점·5축 노트를 생성한다',
    model: options.model,
    systemPrompt: SOMMELIER_SYSTEM_PROMPT,
    tools: buildReadonlyTools({ repo: options.repo }),
    structuredOutputSchema: SommelierOutput,
    printer: false,
  });
}

export { SOMMELIER_PROMPT_VERSION };
