/**
 * agents/tasteProfile.ts — 취향 프로파일 에이전트 (R7).
 *
 * `lib/domain/profile.ts` 의 `buildTasteProfile` 이 계산한 liked/disliked/axes
 * 를 근거로, narrative·recommendations·shoppingGuide 서술만 이 에이전트가
 * 생성한다 (수치 계산은 순수 함수의 책임 — design.md '통계는 코드가 계산한다').
 */
import { Agent, type Model } from '@strands-agents/sdk';
import { z } from 'zod';
import { Recommendation } from '@waganda/schemas';
import type { Repository } from '@app/db/repository';
import { buildReadonlyTools } from '../tools/index.js';
import {
  TASTE_PROFILE_PROMPT_VERSION,
  TASTE_PROFILE_SYSTEM_PROMPT,
} from '../prompts/tasteProfile.js';

/** 취향 프로파일 에이전트의 서술 출력 계약 — 수치가 아닌 서술만 생성한다 */
export const TasteProfileNarrativeOutput = z.object({
  narrative: z.string().min(1).max(4000),
  recommendations: z.array(Recommendation).max(5),
  shoppingGuide: z.string().max(600).optional(),
});
export type TasteProfileNarrativeOutput = z.infer<typeof TasteProfileNarrativeOutput>;

export interface CreateTasteProfileAgentOptions {
  model: Model;
  repo: Repository;
}

export function createTasteProfileAgent(options: CreateTasteProfileAgentOptions): Agent {
  return new Agent({
    id: 'taste-profile',
    name: '취향 프로파일',
    description: '누적 시음 통계로부터 선호/비선호 서술과 추천을 생성한다',
    model: options.model,
    systemPrompt: TASTE_PROFILE_SYSTEM_PROMPT,
    tools: buildReadonlyTools({ repo: options.repo }),
    structuredOutputSchema: TasteProfileNarrativeOutput,
    printer: false,
  });
}

export { TASTE_PROFILE_PROMPT_VERSION };
