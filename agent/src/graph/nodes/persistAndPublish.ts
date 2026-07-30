/**
 * graph/nodes/persistAndPublish.ts — 세션 B 마지막 노드. 결과 저장, 작업
 * 완료 처리, CDN 무효화 발행.
 *
 * design.md 원칙 3(LLM 도구는 읽기 전용) 의 반대편 — **쓰기는 결정론적 노드
 * 에서만 수행한다**는 원칙이 바로 이 노드다. 소믈리에 에이전트의 출력을
 * 실제로 DynamoDB에 쓰는 지점은 여기뿐이다.
 */
import type { Repository } from '@app/db/repository';
import type { SommelierOutput } from '@waganda/schemas';
import type { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { toAnalysisRecord } from './sommelierAnalysis.js';
import type { PipelineContext } from '../pipeline.js';

export interface PersistAndPublishDeps {
  repo: Repository;
  cloudFrontClient: CloudFrontClient;
  cloudFrontDistributionId: string;
  modelId: string;
  traceId: string;
}

export function makePersistAndPublishNode(deps: PersistAndPublishDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    const sommelierOutput = ctx.data['sommelierOutput'] as SommelierOutput | undefined;
    if (!sommelierOutput) {
      throw new Error('persistAndPublish 노드 진입 전에 sommelierAnalysis 가 실행되어야 합니다.');
    }

    const promptVersion = (ctx.data['sommelierPromptVersion'] as string | undefined) ?? 'unknown';
    const analysis = toAnalysisRecord(
      ctx.tastingId,
      sommelierOutput,
      promptVersion,
      deps.modelId,
      deps.traceId,
    );

    const existingAnalysis = await deps.repo.getAnalysis(ctx.tastingId);
    if (existingAnalysis) {
      await deps.repo.patchAnalysis(ctx.tastingId, existingAnalysis.rev, analysis);
    } else {
      await deps.repo.putAnalysis(analysis);
    }

    const job = await deps.repo.getJob(ctx.tastingId);
    if (job) {
      const now = new Date().toISOString();
      await deps.repo.patchJob(ctx.tastingId, job.rev, {
        status: 'completed',
        finishedAt: now,
      });
    }

    // CloudFront 무효화 — design.md '캐시 및 무효화 전략': 단일 `/*` 패턴을 쓴다.
    await deps.cloudFrontClient.send(
      new CreateInvalidationCommand({
        DistributionId: deps.cloudFrontDistributionId,
        InvalidationBatch: {
          CallerReference: `${ctx.tastingId}-${Date.now()}`,
          Paths: { Quantity: 1, Items: ['/*'] },
        },
      }),
    );

    ctx.data['persisted'] = true;
  };
}
