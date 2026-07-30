/**
 * graph/nodes/refreshProfile.ts — 조건부 노드. 완료 시음 수가 5의 배수일 때만
 * 취향 프로파일을 재계산한다 (R7).
 *
 * `shouldRun` 판정은 `@app/domain/profile` 의 `shouldRefreshProfile`
 * (결정론적 술어)에 위임한다 — "지금 갱신할지"를 모델에게 묻지 않는다
 * (design.md '파이프라인 그래프').
 */
import type { Agent } from '@strands-agents/sdk';
import type { Repository } from '@app/db/repository';
import { buildTasteProfile, shouldRefreshProfile } from '@app/domain/profile';
import type { StatsInputTasting } from '@app/domain/types';
import { TASTE_PROFILE_PROMPT_VERSION } from '../../prompts/tasteProfile.js';
import { TasteProfileNarrativeOutput } from '../../agents/tasteProfile.js';
import type { PipelineContext } from '../pipeline.js';

export interface RefreshProfileDeps {
  repo: Repository;
  agent: Agent;
  modelId: string;
  /** 완료 시음 수 계산용 — computeStats 도구와 동일한 방식으로 평면화된 목록 */
  loadCompletedTastings: () => Promise<StatsInputTasting[]>;
}

/** 완료 시음 수가 5의 배수인지로 갱신 필요 여부를 판정한다 */
export function makeRefreshProfileShouldRun(deps: RefreshProfileDeps) {
  return async (): Promise<boolean> => {
    const tastings = await deps.loadCompletedTastings();
    return shouldRefreshProfile(tastings.length);
  };
}

export function makeRefreshProfileNode(deps: RefreshProfileDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    const tastings = await deps.loadCompletedTastings();
    const computed = buildTasteProfile(tastings);

    const agentResult = await deps.agent.invoke(
      `<liked>${JSON.stringify(computed.liked)}</liked>\n<disliked>${JSON.stringify(computed.disliked)}</disliked>\n<axes>${JSON.stringify(computed.axes ?? {})}</axes>\n위 통계 결과를 근거로 서술을 생성하라.`,
    );

    const narrative = TasteProfileNarrativeOutput.safeParse(
      agentResult.structuredOutput ?? agentResult.lastMessage,
    );

    const existing = await deps.repo.getProfile();
    const now = new Date().toISOString();

    const profile = {
      ...computed,
      narrative: narrative.success ? narrative.data.narrative : undefined,
      recommendations: narrative.success ? narrative.data.recommendations : [],
      shoppingGuide: narrative.success ? narrative.data.shoppingGuide : undefined,
      promptVersion: TASTE_PROFILE_PROMPT_VERSION,
      modelId: deps.modelId,
      agreementTrend: existing?.agreementTrend ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      rev: existing?.rev ?? 0,
    };

    if (existing) {
      await deps.repo.patchProfile(existing.rev, profile);
    } else {
      await deps.repo.putProfile(profile);
    }

    ctx.data['profileRefreshed'] = true;
  };
}
