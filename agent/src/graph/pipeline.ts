/**
 * graph/pipeline.ts — 파이프라인 그래프를 "데이터"로 선언한다.
 *
 * **왜 Strands `Graph`(`@strands-agents/sdk/multiagent`)를 쓰지 않는가**:
 * 1. design.md 가 전제한 `GraphBuilder` 는 TS SDK 1.11.2 에 존재하지 않는다.
 *    실제로 존재하는 `Graph` 는 `new Graph({ nodes, edges })` 형태의 선언적
 *    생성자이며 이는 채택 가능하지만, 그 노드 정의(`NodeDefinition`)는
 *    `InvokableAgent | MultiAgent | Node | AgentNodeOptions | MultiAgentNodeOptions`
 *    만 받는다 — 즉 "노드 = 에이전트(또는 서브그래프)" 라는 전제가 강하다.
 * 2. 이 파이프라인의 노드 대부분(ensureJob, startTranscription, extractAcoustic,
 *    loadState, mapSpeakers, refreshProfile 조건 판정, runDiscovery 조건 판정,
 *    persistAndPublish)은 **모델을 호출하지 않는 순수 결정 로직**이다. 이런
 *    노드를 Strands `Node` 를 상속해 억지로 만들면(model 이 없는 `AgentNode`)
 *    프레임워크의 스트리밍·스냅샷·인터럽트 기능을 전혀 쓰지 않으면서 그
_ *    복잡도만 떠안는다.
 * 3. 재개 정합성의 원천은 DynamoDB `Job.completedSteps` 이며(design.md
 *    '재개 전략'), Strands 세션 재개 의미론에 의존하지 않는다. 따라서
 *    Strands `Graph` 의 재개 메커니즘(`_findResumeTargets` 등)이 필요 없다.
 *
 * 결론: 파이프라인 그래프는 이 파일에서 노드(이름+실행함수+조건부 실행 서술)와
 * 엣지를 데이터로 선언하고, `graph/executor.ts` 의 순수 오케스트레이터가 직접
 * 실행한다. **모델을 호출하는 노드(sommelier_analysis, refresh_taste_profile,
 * run_discovery 의 서술 생성 부분)만 내부적으로 Strands `Agent` 를 사용한다** —
 * Strands 를 안 쓰는 게 아니라, 그 강점(모델 오케스트레이션)이 필요한 지점에만
 * 국한해서 쓴다.
 */
import type { PipelineStep } from '@waganda/schemas';

/**
 * 노드 실행 컨텍스트 — 모든 노드가 공유하는 가변 상태. 그래프 실행 중
 * 노드들이 여기 채워가며 다음 노드에 전달한다. 필드는 파이프라인 진행에
 * 따라 점진적으로 채워지므로 optional 이 많다.
 */
export interface PipelineContext {
  tastingId: string;
  /** 이번 실행에서 새로 완료된 단계 (실행 결과 보고용) */
  newlyCompletedSteps: PipelineStep[];
  /** 이번 실행에서 건너뛴 단계 (이미 완료됨) */
  skippedSteps: PipelineStep[];
  /** 노드 간 공유하는 임의의 작업 데이터 — 각 노드가 필요한 키만 읽고 쓴다 */
  data: Record<string, unknown>;
  /** 그래프 실행 실패 시 사유 (한국어) */
  error?: string;
}

/** 노드 실행 결과 — 다음 엣지 판정에 쓰인다 */
export type NodeOutcome = 'completed' | 'skipped' | 'failed';

/** 파이프라인 노드 정의 — 이름 + 실행 함수 + 조건부 실행 서술을 데이터로 선언한다 */
export interface PipelineNode {
  /** `PipelineStep` 과 1:1 대응하는 노드 이름 (Job.completedSteps 에 기록되는 값) */
  name: PipelineStep;
  /**
   * 이 노드를 실행해야 하는지 판정하는 결정론적 술어.
   * - `completedSteps` 에 이미 있으면 실행기(executor)가 자동으로 건너뛴다
   *   (모든 노드가 멱등이라는 전제와 별개로, 재실행 자체를 생략해 비용을 아낀다).
   * - 이 필드가 있으면 추가로 "완료되지 않았어도 지금 실행할 필요가 없다"는
   *   조건부 실행(refresh_taste_profile, run_discovery)을 표현한다.
   */
  shouldRun?: (ctx: PipelineContext) => boolean | Promise<boolean>;
  /** 노드 본체. 실행 후 ctx.data 를 갱신하고, 실패 시 예외를 던진다 */
  run: (ctx: PipelineContext) => Promise<void>;
}

/** 노드 간 실행 순서 — 조건부 엣지가 필요하면 `when` 을 둔다(EdgeHandler 상당) */
export interface PipelineEdge {
  from: PipelineStep;
  to: PipelineStep;
  /** 조건부 엣지 — 생략하면 항상 통과 */
  when?: (ctx: PipelineContext) => boolean | Promise<boolean>;
}

/** 그래프 정의 — 노드 목록과 엣지 목록만으로 구성된 순수 데이터 */
export interface PipelineGraphDefinition {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  /** 진입 노드(들) — 들어오는 엣지가 없는 노드 */
  sources: PipelineStep[];
}

/** 그래프 정의 유효성 검증 — 노드 이름 중복, 존재하지 않는 노드를 가리키는 엣지를 방지 */
export function validatePipelineGraph(def: PipelineGraphDefinition): void {
  const names = new Set<string>();
  for (const node of def.nodes) {
    if (names.has(node.name)) {
      throw new Error(`파이프라인 그래프에 중복된 노드 이름이 있습니다: ${node.name}`);
    }
    names.add(node.name);
  }
  for (const edge of def.edges) {
    if (!names.has(edge.from) || !names.has(edge.to)) {
      throw new Error(`파이프라인 그래프의 엣지가 존재하지 않는 노드를 참조합니다: ${edge.from} -> ${edge.to}`);
    }
  }
  for (const source of def.sources) {
    if (!names.has(source)) {
      throw new Error(`파이프라인 그래프의 진입 노드가 존재하지 않습니다: ${source}`);
    }
  }
}

/** 노드 이름 → 다음 노드 이름 목록 매핑을 만든다 (executor 가 순회에 사용) */
export function buildAdjacency(def: PipelineGraphDefinition): Map<PipelineStep, PipelineEdge[]> {
  const adjacency = new Map<PipelineStep, PipelineEdge[]>();
  for (const edge of def.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  }
  return adjacency;
}
