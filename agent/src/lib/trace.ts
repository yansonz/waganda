/**
 * lib/trace.ts — 파이프라인 실행 트레이스 기록 (design.md '트레이스', tasks.md 16.2).
 *
 * OpenTelemetry(ADOT)가 AgentCore Runtime 에서 자동 계측되므로 스팬 생성 자체는
 * 별도 구현이 필요 없다(design.md 위험 완화 항목). 이 파일은 그 위에 얹는
 * **애플리케이션 레벨 트레이스 레코드**를 만든다 — 단계 이름, 도구 호출 목록,
 * 지연시간, 토큰 사용량, 비용 추정, 사용된 프롬프트 버전을 하나의 구조로 모아
 * `Job`/`Analysis` 레코드의 `traceId` 로 연결할 수 있게 한다.
 *
 * 트레이스 데이터는 공개 화면에 노출하지 않는다(16.6) — 이 모듈은 저장/전달만
 * 책임지며, 공개 API 라우트에서 참조하지 않아야 한다는 제약은 app 워크스페이스의
 * 책임이다.
 */
import { randomUUID } from 'node:crypto';

/** 도구 호출 1건의 기록 */
export interface ToolCallTrace {
  toolName: string;
  /** 입력 요약 — 원문 전체가 아닌 요약만 남긴다(민감정보·토큰 절약) */
  inputSummary: string;
  outputSummary: string;
  latencyMs: number;
  ok: boolean;
}

/** 파이프라인 한 단계(노드)의 실행 기록 */
export interface StepTrace {
  step: string;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  ok: boolean;
  /** 이 단계에서 모델을 호출했다면 사용된 프롬프트 버전 */
  promptVersion?: string;
  /** 이 단계에서 사용된 모델 ID (추론 프로파일 ARN 포함 가능) */
  modelId?: string;
  /** 입력/출력 토큰 사용량 */
  tokenUsage?: { inputTokens: number; outputTokens: number };
  /** Bedrock 온디맨드 단가 기반 추정 비용(USD) — 관측용 근사치 */
  estimatedCostUsd?: number;
  toolCalls: ToolCallTrace[];
  error?: string;
}

/** 하나의 그래프 실행 전체를 아우르는 트레이스 */
export interface PipelineTrace {
  traceId: string;
  tastingId?: string;
  task: string;
  startedAt: string;
  steps: StepTrace[];
}

/** 새 트레이스를 시작한다 */
export function startTrace(task: string, tastingId?: string): PipelineTrace {
  return {
    traceId: randomUUID(),
    tastingId,
    task,
    startedAt: new Date().toISOString(),
    steps: [],
  };
}

/** 트레이스에 완료된 단계 기록을 추가한다 (오케스트레이터/에이전트를 계층으로 남기는 대신,
 *  단계 이름 자체가 오케스트레이터-서브에이전트 관계를 드러내도록 `step` 명명 규칙을 따른다) */
export function recordStep(trace: PipelineTrace, step: StepTrace): void {
  trace.steps.push(step);
}

/** 단계 실행을 감싸 시작/종료 시각과 지연시간을 자동 계산하는 헬퍼 */
export async function withStepTrace<T>(
  trace: PipelineTrace,
  step: string,
  run: () => Promise<{ result: T; meta?: Partial<Omit<StepTrace, 'step' | 'startedAt' | 'finishedAt' | 'latencyMs' | 'ok'>> }>,
): Promise<T> {
  const startedAt = new Date();
  try {
    const { result, meta } = await run();
    const finishedAt = new Date();
    recordStep(trace, {
      step,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      latencyMs: finishedAt.getTime() - startedAt.getTime(),
      ok: true,
      toolCalls: meta?.toolCalls ?? [],
      promptVersion: meta?.promptVersion,
      modelId: meta?.modelId,
      tokenUsage: meta?.tokenUsage,
      estimatedCostUsd: meta?.estimatedCostUsd,
    });
    return result;
  } catch (err) {
    const finishedAt = new Date();
    recordStep(trace, {
      step,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      latencyMs: finishedAt.getTime() - startedAt.getTime(),
      ok: false,
      toolCalls: [],
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
