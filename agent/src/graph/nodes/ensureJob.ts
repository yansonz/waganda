/**
 * graph/nodes/ensureJob.ts — 세션 A 첫 노드. 작업 레코드 생성/조회 (멱등).
 *
 * 이미 `analyzing` 이상(analyzing/completed/failed)이면 그래프 실행 자체를
 * 즉시 종료해야 한다 — 이는 이 노드가 아니라 세션 A 최상위 함수
 * (`graph/nodes/index` 상당의 조합부)에서 `ensure_job` 실행 후 상태를 보고
 * 결정한다. 이 노드는 "Job 이 없으면 만들고, 있으면 그대로 둔다"까지만
 * 책임진다 — 단일 책임을 유지해 테스트하기 쉽게 한다.
 */
import type { Repository } from '@app/db/repository';
import type { Job } from '@waganda/schemas';
import type { PipelineContext } from '../pipeline.js';

export interface EnsureJobDeps {
  repo: Repository;
  recordingId?: string;
}

/** 작업 레코드가 없으면 `queued` 상태로 생성한다. 있으면 그대로 반환한다 (멱등) */
export async function ensureJob(deps: EnsureJobDeps, ctx: PipelineContext): Promise<Job> {
  const existing = await deps.repo.getJob(ctx.tastingId);
  if (existing) {
    ctx.data['job'] = existing;
    return existing;
  }

  const now = new Date().toISOString();
  const job: Job = {
    type: 'JOB',
    tastingId: ctx.tastingId,
    status: 'queued',
    completedSteps: [],
    recordingId: deps.recordingId,
    attempts: 0,
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  await deps.repo.putJob(job);
  ctx.data['job'] = job;
  return job;
}

/** ensureJob 노드 팩토리 — PipelineNode.run 시그니처에 맞춘다 */
export function makeEnsureJobNode(deps: EnsureJobDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    await ensureJob(deps, ctx);
  };
}

/** 작업이 이미 analyzing 이상 단계에 진입했는지 판정 — 세션 A 조기 종료 조건 */
export function isAlreadyBeyondQueued(job: Job): boolean {
  return job.status === 'analyzing' || job.status === 'completed' || job.status === 'failed';
}
