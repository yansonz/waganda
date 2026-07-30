/**
 * graph/executor.ts — `graph/pipeline.ts` 가 데이터로 선언한 그래프를 직접
 * 실행하는 순수 오케스트레이터. Strands 프레임워크에 의존하지 않는다
 * (이유는 `pipeline.ts` 상단 주석 참고).
 *
 * 실행 규칙:
 * - `sources` 에서 시작해 엣지를 따라 진행한다. 이 파이프라인은 선형(분기 없는
 *   단일 경로)이므로 위상정렬 없이 소스에서부터 순차 방문으로 충분하다.
 *   세션 B에 조건부 노드(refresh_taste_profile, run_discovery)가 있지만
 *   이들도 "실행하거나 건너뛰거나"의 단일 경로이며 병렬 분기가 아니다.
 * - 노드 진입 시 `completedSteps` 에 이미 있으면 실행을 건너뛰고
 *   `skippedSteps` 에 기록한다 (design.md '재개 전략' — completedSteps 기반
 *   스킵).
 * - `shouldRun` 이 있고 false 를 반환하면 완료 처리 없이 건너뛴다(조건부 노드).
 * - 한 노드가 실패하면 그래프 실행 전체를 멈추고 실패를 던진다 — 호출부
 *   (그래프별 최상위 함수)가 Job 상태를 'failed' 로 전환하고 원본을 보존한다.
 */
import type { PipelineStep } from '@waganda/schemas';
import type { PipelineContext, PipelineGraphDefinition } from './pipeline.js';
import { buildAdjacency, validatePipelineGraph } from './pipeline.js';

export interface ExecutePipelineOptions {
  /** 그래프 진입 시점에 이미 완료된 단계 — Job.completedSteps 로부터 전달받는다 */
  completedSteps: PipelineStep[];
}

export interface ExecutePipelineResult {
  ctx: PipelineContext;
  /** 그래프 실행이 끝까지 성공했는지 (실패 노드가 없었는지) */
  ok: boolean;
}

/**
 * 정의된 그래프를 소스 노드부터 순차적으로 실행한다. 도중 실패하면 예외를
 * 던지지 않고 `ok: false` 와 `ctx.error` 로 반환한다 — 호출부가 부분 결과를
 * 그대로 활용해 저장/보존 결정을 내릴 수 있게 한다(design.md '가드레일
 * 중단' — 부분 결과 보존).
 */
export async function executePipeline(
  def: PipelineGraphDefinition,
  tastingId: string,
  options: ExecutePipelineOptions,
): Promise<ExecutePipelineResult> {
  validatePipelineGraph(def);

  const nodeByName = new Map(def.nodes.map((n) => [n.name, n]));
  const adjacency = buildAdjacency(def);
  const completed = new Set(options.completedSteps);

  const ctx: PipelineContext = {
    tastingId,
    newlyCompletedSteps: [],
    skippedSteps: [],
    data: {},
  };

  let current: PipelineStep | undefined = def.sources[0];

  while (current !== undefined) {
    const node = nodeByName.get(current);
    if (!node) break;

    if (completed.has(node.name)) {
      ctx.skippedSteps.push(node.name);
    } else {
      const shouldRun = node.shouldRun ? await node.shouldRun(ctx) : true;
      if (!shouldRun) {
        ctx.skippedSteps.push(node.name);
      } else {
        try {
          await node.run(ctx);
          ctx.newlyCompletedSteps.push(node.name);
          completed.add(node.name);
        } catch (err) {
          ctx.error = err instanceof Error ? err.message : String(err);
          return { ctx, ok: false };
        }
      }
    }

    const edges = adjacency.get(current) ?? [];
    let next: PipelineStep | undefined;
    for (const edge of edges) {
       
      const pass = edge.when ? await edge.when(ctx) : true;
      if (pass) {
        next = edge.to;
        break;
      }
    }
    current = next;
  }

  return { ctx, ok: true };
}
