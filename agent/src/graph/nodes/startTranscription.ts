/**
 * graph/nodes/startTranscription.ts — Transcribe 작업 시작 (세션 A).
 *
 * 작업명은 `tastingId` + `recordingId` 기반 **결정론적** 문자열로 생성한다 —
 * 재시도(SQS 재구동, 세션 A 재호출)시에도 동일 작업명이 나오므로, Transcribe
 * 에 이미 같은 이름의 작업이 있으면 새로 만들지 않고 그대로 재사용한다
 * (design.md '트랜스크립션' — 중복 생성 방지).
 */
import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  type TranscribeClient,
} from '@aws-sdk/client-transcribe';
import type { Repository } from '@app/db/repository';
import type { PipelineContext } from '../pipeline.js';

export interface StartTranscriptionDeps {
  repo: Repository;
  transcribeClient: TranscribeClient;
  /** 미디어 버킷 이름 — 입력·출력 S3 URI 구성에 필요 */
  mediaBucket: string;
  audioKey: string;
  recordingId: string;
}

/** `tastingId` + `recordingId` 기반 결정론적 Transcribe 작업명을 만든다 */
export function buildTranscribeJobName(tastingId: string, recordingId: string): string {
  return `waganda-${tastingId}-${recordingId}`;
}

/** 이미 같은 이름의 Transcribe 작업이 있는지 확인한다 (재시도 시 중복 생성 방지) */
async function transcriptionJobExists(client: TranscribeClient, jobName: string): Promise<boolean> {
  try {
    await client.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = 'name' in err ? String((err as { name?: unknown }).name) : undefined;
  return name === 'BadRequestException' || name === 'NotFoundException';
}

/**
 * Transcribe 작업을 시작한다. 이미 존재하면(재시도) 그대로 건너뛰고 작업명만
 * ctx 에 기록한다. `ko-KR` 고정, 화자분리 최대 2명(design.md '트랜스크립션').
 */
export function makeStartTranscriptionNode(deps: StartTranscriptionDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    const jobName = buildTranscribeJobName(ctx.tastingId, deps.recordingId);

    const exists = await transcriptionJobExists(deps.transcribeClient, jobName);
    if (!exists) {
      await deps.transcribeClient.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          LanguageCode: 'ko-KR',
          Media: { MediaFileUri: `s3://${deps.mediaBucket}/${deps.audioKey}` },
          Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
          OutputBucketName: deps.mediaBucket,
          OutputKey: `transcripts/${ctx.tastingId}/${deps.recordingId}.json`,
        }),
      );
    }

    ctx.data['transcribeJobName'] = jobName;

    const existingJob = await deps.repo.getJob(ctx.tastingId);
    if (existingJob) {
      await deps.repo.patchJob(ctx.tastingId, existingJob.rev, {
        transcribeJobName: jobName,
        status: 'transcribing',
      });
    }
  };
}
