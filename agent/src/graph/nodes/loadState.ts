/**
 * graph/nodes/loadState.ts — 세션 B 첫 노드. 작업 상태·트랜스크립트·음향
 * 특징을 적재하고 `completedSteps` 로 이후 분기를 결정한다.
 *
 * 트랜스크립트가 무음이거나 텍스트가 거의 없어도 실패로 처리하지 않는다
 * (design.md '에러 처리' — "트랜스크립트 무음·공백: 실패로 처리하지 않고
 * 침묵 자체를 해석 입력으로 사용"). 이 노드는 무음 여부를 판정만 하고
 * ctx.data 에 표시할 뿐, 그 자체로 그래프를 중단시키지 않는다.
 */
import { GetTranscriptionJobCommand, type TranscribeClient } from '@aws-sdk/client-transcribe';
import type { Repository } from '@app/db/repository';
import { Transcript, type Job, type Recording } from '@waganda/schemas';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { PipelineContext } from '../pipeline.js';

export interface LoadStateDeps {
  repo: Repository;
  transcribeClient: TranscribeClient;
  s3Client: S3Client;
  mediaBucket: string;
  recordingId: string;
  transcribeStatus: 'COMPLETED' | 'FAILED';
}

async function readS3Json(s3: S3Client, bucket: string, key: string): Promise<unknown> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await response.Body?.transformToString();
  if (!body) throw new Error(`S3 객체 본문이 비어 있습니다: ${key}`);
  return JSON.parse(body);
}

/** Transcribe 원시 출력을 `Transcript` 스키마로 변환한다 (화자분리 세그먼트 포함) */
function parseTranscribeOutput(raw: unknown): Transcript {
  const record = raw as {
    results?: {
      transcripts?: { transcript?: string }[];
      speaker_labels?: { segments?: { speaker_label?: string; start_time?: string; end_time?: string }[] };
    };
  };

  const fullText = record.results?.transcripts?.[0]?.transcript ?? '';
  const speakerSegments = record.results?.speaker_labels?.segments ?? [];

  const segments = speakerSegments.map((seg) => ({
    start: Number(seg.start_time ?? 0),
    end: Number(seg.end_time ?? 0),
    speaker:
      seg.speaker_label === 'spk_0'
        ? ('speaker_1' as const)
        : seg.speaker_label === 'spk_1'
          ? ('speaker_2' as const)
          : undefined,
    text: '',
  }));

  return Transcript.parse({ language: 'ko-KR', fullText, segments });
}

/**
 * 작업·녹음 레코드를 적재하고, Transcribe 상태가 FAILED 면 예외를 던져
 * 상위(그래프 최상위 함수)가 Job 을 `failed` 로 전환하게 한다. 무음
 * 트랜스크립트는 실패가 아니라 정상 데이터로 취급한다.
 */
export function makeLoadStateNode(deps: LoadStateDeps) {
  return async (ctx: PipelineContext): Promise<void> => {
    if (deps.transcribeStatus === 'FAILED') {
      throw new Error('Transcribe 작업이 실패했습니다 (FAILED 상태로 통보됨).');
    }

    const job = await deps.repo.getJob(ctx.tastingId);
    if (!job) {
      throw new Error(`작업 레코드를 찾을 수 없습니다: tastingId=${ctx.tastingId}`);
    }
    ctx.data['job'] = job;

    const recording = await deps.repo.getRecording(ctx.tastingId, deps.recordingId);
    if (!recording) {
      throw new Error(`녹음 레코드를 찾을 수 없습니다: recordingId=${deps.recordingId}`);
    }

    let transcript = recording.transcript;
    if (!transcript && job.transcribeJobName) {
      const jobResult = await deps.transcribeClient.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: job.transcribeJobName }),
      );
      const outputKey = `transcripts/${ctx.tastingId}/${deps.recordingId}.json`;
      const raw = await readS3Json(deps.s3Client, deps.mediaBucket, outputKey);
      transcript = parseTranscribeOutput(raw);

      void jobResult; // 상태 확인 목적 — FAILED 는 위에서 이미 처리했으므로 재확인만

      await deps.repo.patchRecording(ctx.tastingId, deps.recordingId, recording.rev, { transcript });
    }

    const isSilent = !transcript || transcript.fullText.trim().length === 0;

    ctx.data['recording'] = { ...recording, transcript } satisfies Recording;
    ctx.data['transcript'] = transcript;
    ctx.data['isSilentTranscript'] = isSilent;
    ctx.data['completedSteps'] = job.completedSteps;
  };
}

/** loadState 결과에서 Job 을 꺼낸다 — 다른 노드가 재사용할 때의 타입 안전 헬퍼 */
export function getLoadedJob(ctx: PipelineContext): Job {
  const job = ctx.data['job'] as Job | undefined;
  if (!job) throw new Error('loadState 노드가 아직 실행되지 않았습니다.');
  return job;
}
