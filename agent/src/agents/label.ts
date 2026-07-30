/**
 * agents/label.ts — 라벨 인식 에이전트 (R3).
 *
 * 멀티모달 입력(라벨 이미지)으로부터 와인 필드를 추출한다. `findWines`(카탈로그
 * 중복 후보 조회)와 `webSearch`(보강)만 사용하며, 둘 다 읽기 전용이다.
 */
import { Agent, type Model } from '@strands-agents/sdk';
import { LabelExtraction } from '@waganda/schemas';
import type { Repository } from '@app/db/repository';
import { buildReadonlyTools } from '../tools/index.js';
import { LABEL_PROMPT_VERSION, LABEL_SYSTEM_PROMPT } from '../prompts/label.js';
import type { WebSearchProvider } from '../tools/web.js';

export interface CreateLabelAgentOptions {
  model: Model;
  repo: Repository;
  webSearchProvider?: WebSearchProvider;
}

export function createLabelAgent(options: CreateLabelAgentOptions): Agent {
  return new Agent({
    id: 'label',
    name: '라벨 인식',
    description: '와인 라벨 사진에서 정형 필드와 시각 태그를 추출한다',
    model: options.model,
    systemPrompt: LABEL_SYSTEM_PROMPT,
    tools: buildReadonlyTools({ repo: options.repo, webSearchProvider: options.webSearchProvider }),
    structuredOutputSchema: LabelExtraction,
    printer: false,
  });
}

export { LABEL_PROMPT_VERSION };
