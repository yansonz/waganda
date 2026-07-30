import { describe, expect, it, vi } from 'vitest';
import { InMemoryRepository } from './helpers/inMemoryRepository.js';
import { buildSessionAGraph } from '../src/graph/sessionA.js';
import { executePipeline } from '../src/graph/executor.js';
import { buildTranscribeJobName } from '../src/graph/nodes/startTranscription.js';

/** GetTranscriptionJobCommand/StartTranscriptionJobCommand 를 흉내내는 가짜 Transcribe 클라이언트 */
function createFakeTranscribeClient() {
  const existingJobs = new Set<string>();
  const startCalls: string[] = [];

  const client = {
    send: vi.fn(async (command: { constructor: { name: string }; input?: Record<string, unknown> }) => {
      if (command.constructor.name === 'GetTranscriptionJobCommand') {
        const jobName = String(command.input?.['TranscriptionJobName']);
        if (!existingJobs.has(jobName)) {
          const err = new Error('not found') as Error & { name: string };
          err.name = 'BadRequestException';
          throw err;
        }
        return {};
      }
      if (command.constructor.name === 'StartTranscriptionJobCommand') {
        const jobName = String(command.input?.['TranscriptionJobName']);
        existingJobs.add(jobName);
        startCalls.push(jobName);
        return {};
      }
      throw new Error(`알 수 없는 명령: ${command.constructor.name}`);
    }),
  };

  return { client, startCalls };
}

function createFakeLambdaClient(payload: unknown) {
  return {
    send: vi.fn(async () => ({
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    })),
  };
}

const ACOUSTIC_PAYLOAD = {
  rmsCurve: [0.1, 0.2],
  frameSec: 0.1,
  f0Track: [{ t: 0, hz: 120 }],
  silences: [],
  speechRate: 2,
  laughterCandidates: [],
  durationSec: 10,
};

describe('세션 A — 업로드 직후 파이프라인', () => {
  it('동일 오디오로 중복 트리거해도 Transcribe 작업이 중복 생성되지 않는다', async () => {
    const repo = new InMemoryRepository();
    const { client: transcribeClient, startCalls } = createFakeTranscribeClient();
    const lambdaClient = createFakeLambdaClient(ACOUSTIC_PAYLOAD);

    const buildGraph = () =>
      buildSessionAGraph({
        ensureJob: { repo, recordingId: 'rec-1' },
        startTranscription: {
          repo,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transcribeClient: transcribeClient as any,
          mediaBucket: 'media-bucket',
          audioKey: 'uploads/rec-1.wav',
          recordingId: 'rec-1',
        },
        extractAcoustic: {
          repo,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lambdaClient: lambdaClient as any,
          audioLambdaFunctionName: 'audio-fn',
          recordingId: 'rec-1',
          audioKey: 'uploads/rec-1.wav',
        },
      });

    // 1차 실행
    const first = await executePipeline(buildGraph(), 'tasting-1', { completedSteps: [] });
    expect(first.ok).toBe(true);
    expect(first.ctx.newlyCompletedSteps).toEqual([
      'ensure_job',
      'start_transcription',
      'extract_acoustic',
    ]);

    const job1 = await repo.getJob('tasting-1');
    expect(job1?.completedSteps).toBeDefined();

    // 동일 오디오로 재트리거 (예: SQS 재시도) — completedSteps 를 그대로 넘긴다
    const second = await executePipeline(buildGraph(), 'tasting-1', {
      completedSteps: first.ctx.newlyCompletedSteps,
    });
    expect(second.ok).toBe(true);
    expect(second.ctx.skippedSteps).toEqual([
      'ensure_job',
      'start_transcription',
      'extract_acoustic',
    ]);

    // Transcribe 작업은 1차에서만 생성되어야 한다
    expect(startCalls.length).toBe(1);
    expect(startCalls[0]).toBe(buildTranscribeJobName('tasting-1', 'rec-1'));
  });

  it('completedSteps 로 이미 완료된 단계는 재실행하지 않고 건너뛴다', async () => {
    const repo = new InMemoryRepository();
    const now = new Date().toISOString();
    await repo.putJob({
      type: 'JOB',
      tastingId: 'tasting-2',
      status: 'transcribing',
      completedSteps: ['ensure_job', 'start_transcription'],
      recordingId: 'rec-2',
      attempts: 0,
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });

    const { client: transcribeClient, startCalls } = createFakeTranscribeClient();
    const lambdaClient = createFakeLambdaClient(ACOUSTIC_PAYLOAD);

    const graph = buildSessionAGraph({
      ensureJob: { repo, recordingId: 'rec-2' },
      startTranscription: {
        repo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transcribeClient: transcribeClient as any,
        mediaBucket: 'media-bucket',
        audioKey: 'uploads/rec-2.wav',
        recordingId: 'rec-2',
      },
      extractAcoustic: {
        repo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lambdaClient: lambdaClient as any,
        audioLambdaFunctionName: 'audio-fn',
        recordingId: 'rec-2',
        audioKey: 'uploads/rec-2.wav',
      },
    });

    const result = await executePipeline(graph, 'tasting-2', {
      completedSteps: ['ensure_job', 'start_transcription'],
    });

    expect(result.ok).toBe(true);
    expect(result.ctx.skippedSteps).toEqual(['ensure_job', 'start_transcription']);
    expect(result.ctx.newlyCompletedSteps).toEqual(['extract_acoustic']);
    expect(startCalls.length).toBe(0);
  });
});
