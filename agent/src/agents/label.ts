/**
 * agents/label.ts — 라벨 인식 에이전트 (R3).
 *
 * 멀티모달 입력(라벨 이미지)으로부터 와인 필드를 추출한다. `findWines`(카탈로그
 * 중복 후보 조회)와 `webSearch`(보강)만 사용하며, 둘 다 읽기 전용이다.
 *
 * ## 현재 이 에이전트는 실사용 경로가 아니다
 *
 * `POST /api/labels/analyze` 는 `lib/agent/labelDirect.ts` 로 Bedrock 을 직접 호출한다.
 * 이 에이전트를 되살리려면 **두 가지를 먼저 고쳐야 한다.**
 *
 * 1. **이미지를 모델에 전달해야 한다.** `entrypoint.ts` 는 프롬프트에 S3 키를 문자열로만
 *    넘긴다. 그래서 모델이 "이미지에 접근할 수 없다"고 답하며 항상 `recognized: false` 였다.
 *    S3 에서 바이트를 읽어 이미지 블록으로 실어야 한다.
 * 2. **`webSearch` 를 도구로 주지 말 것.** 호출 시점이 모델 자율 판단에 맡겨지면,
 *    인식이 이미 실패한 상황에서도 검색을 호출한다(실제로 그랬다). SerpAPI 무료 티어는
 *    월 100회이므로 낭비가 크다. 검색은 `lib/agent/labelEnrich.ts` 처럼 **빈 필드가 있을 때만**
 *    코드가 한 번 호출하도록 통제해야 한다.
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
