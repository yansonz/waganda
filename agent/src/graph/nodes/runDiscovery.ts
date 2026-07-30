/**
 * graph/nodes/runDiscovery.ts — 조건부 노드. 완료 시음 10건 이상 + 마지막
 * 실행 이후 5건 이상 증가했을 때만 패턴 발견을 실행한다 (R8).
 *
 * 등급 판정(`gradeDiscovery`)과 중복 차단(`isDuplicate`)은 결정론적 코드가
 * 전담한다. 에이전트는 `DiscoveryCandidate` 후보만 제시한다.
 */
import type { Agent } from '@strands-agents/sdk';
import type { Repository } from '@app/db/repository';
import { gradeDiscovery, isDuplicate, shouldRunDiscovery } from '@app/domain/discovery';
import { randomUUID } from 'node:crypto';
import type { Discovery, DiscoveryCandidate } from '@waganda/schemas';
import { DISCOVERY_PROMPT_VERSION } from '../../prompts/discovery.js';
import { DiscoveryAgentOutput } from '../../agents/discovery.js';
import type { PipelineContext } from '../pipeline.js';

export interface RunDiscoveryDeps {
  repo: Repository;
  agent: Agent;
  modelId: string;
  completedTastingCount: () => Promise<number>;
  lastDiscoveryRunCount: () => Promise<number>;
}

export function makeRunDiscoveryShouldRun(deps: RunDiscoveryDeps) {
  return async (): Promise<boolean> => {
    const [completed, lastRun] = await Promise.all([
      deps.completedTastingCount(),
      deps.lastDiscoveryRunCount(),
    ]);
    return shouldRunDiscovery(completed, lastRun);
  };
}

export function makeRunDiscoveryNode(deps: RunDiscoveryDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    const { items: existingDiscoveries } = await deps.repo.listByType<Discovery>('DISCOVERY', 'desc');

    const agentResult = await deps.agent.invoke(
      '누적 시음 기록에서 뜻밖의 패턴 후보를 computeStats 로 탐색하고 후보 목록을 제시하라.',
    );

    const parsed = DiscoveryAgentOutput.safeParse(agentResult.structuredOutput ?? agentResult.lastMessage);
    if (!parsed.success) {
      // 발견은 부가 기능이므로 파싱 실패 시 그래프 전체를 중단시키지 않고 조용히 건너뛴다.
      ctx.data['discoveriesCreated'] = 0;
      return;
    }

    let created = 0;
    const now = new Date().toISOString();

    for (const candidate of parsed.data.candidates) {
      const grade = gradeDiscovery({ n: candidate.n, deltaVsOverall: candidate.deltaVsOverall });
      if (!grade) continue;
      if (isDuplicate(candidate.groupBy, candidate.key, existingDiscoveries)) continue;

      const discovery: Discovery = {
        id: randomUUID(),
        type: 'DISCOVERY',
        groupBy: candidate.groupBy,
        key: candidate.key,
        alias: candidate.alias,
        description: candidate.description,
        metric: candidate.metric,
        n: candidate.n,
        value: candidate.value,
        deltaVsOverall: candidate.deltaVsOverall,
        grade,
        evidenceTastingIds: candidate.evidenceTastingIds,
        disclaimer:
          '표본이 적어 우연일 수 있습니다. 기록이 쌓이면 다시 판정합니다.',
        hidden: false,
        promptVersion: DISCOVERY_PROMPT_VERSION,
        modelId: deps.modelId,
        schemaVersion: 2,
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };

      await deps.repo.putDiscovery(discovery);
      created += 1;
    }

    ctx.data['discoveriesCreated'] = created;
  };
}

export type { DiscoveryCandidate };
