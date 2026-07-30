import { z } from 'zod';
import { EntityId, IsoDateTime, entityMetaShape } from './common';

export const JobStatus = z.enum(['queued', 'transcribing', 'analyzing', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatus>;

/**
 * 파이프라인 단계 식별자. `completedSteps` 에 쌓여 멱등 재개의 근거가 된다.
 * 프레임워크의 세션 지속성이 아니라 이 목록이 정합성의 원천이다.
 */
export const PipelineStep = z.enum([
  'ensure_job',
  'start_transcription',
  'extract_acoustic',
  'load_state',
  'map_speakers',
  'enrich_wine_meta',
  'sommelier_analysis',
  'refresh_taste_profile',
  'run_discovery',
  'persist_and_publish',
]);
export type PipelineStep = z.infer<typeof PipelineStep>;

export const Job = z.object({
  type: z.literal('JOB'),
  tastingId: EntityId,
  status: JobStatus,
  completedSteps: z.array(PipelineStep).default([]),
  /** Transcribe 작업명 — 결정론적 생성 (중복 방지) */
  transcribeJobName: z.string().max(200).optional(),
  recordingId: EntityId.optional(),
  attempts: z.number().int().min(0).default(0),
  lastError: z.string().max(2000).optional(),
  /** 진행 중 예상 소요 시간(초) — UI 표시용 */
  estimatedSec: z.number().int().min(0).optional(),
  startedAt: IsoDateTime.optional(),
  finishedAt: IsoDateTime.optional(),
  ...entityMetaShape,
});
export type Job = z.infer<typeof Job>;

/** 상태별 예상 소요 시간 (UI 안내용 근사치) */
export const ESTIMATED_SEC_BY_STATUS: Record<JobStatus, number> = {
  queued: 180,
  transcribing: 150,
  analyzing: 60,
  completed: 0,
  failed: 0,
};

/** 재분석 트리거 응답 */
export const AnalyzeResponse = z.object({
  jobStatus: JobStatus,
  tastingId: EntityId,
  completedSteps: z.array(PipelineStep),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;
