import { describe, expect, it, vi } from 'vitest';
import { InMemoryRepository } from './helpers/inMemoryRepository.js';
import { createFakeAgent } from './helpers/fakeAgent.js';
import { buildSessionBGraph } from '../src/graph/sessionB.js';
import { executePipeline } from '../src/graph/executor.js';
import { startTrace } from '../src/lib/trace.js';
import type { Job, Recording } from '@waganda/schemas';

function makeFakeS3Client(objects: Record<string, string>) {
  return {
    send: vi.fn(async (command: { input?: Record<string, unknown> }) => {
      const key = String(command.input?.['Key']);
      const body = objects[key];
      if (body === undefined) throw new Error(`S3 객체 없음: ${key}`);
      return { Body: { transformToString: async () => body } };
    }),
  };
}

function makeFakeTranscribeClient() {
  return { send: vi.fn(async () => ({ TranscriptionJob: { TranscriptionJobStatus: 'COMPLETED' } })) };
}

function makeFakeCloudFrontClient() {
  return { send: vi.fn(async () => ({})) };
}

const VALID_SOMMELIER_OUTPUT = {
  summary: '산미가 도드라지는 화이트 와인이었다.',
  highlights: [{ quote: '와 신선하다', note: '산미에 대한 긍정적 반응' }],
  aiRating: 4,
  notes: { acidity: 4, tannin: 2, body: 3, aroma: 3.5, finish: 3 },
  evidence: [{ field: 'aiRating', basis: '"신선하다"는 발화', kind: 'quote' }],
};

async function seedJobAndRecording(
  repo: InMemoryRepository,
  tastingId: string,
  recordingId: string,
  overrides: { job?: Partial<Job>; recording?: Partial<Recording> } = {},
) {
  const now = new Date().toISOString();
  await repo.putJob({
    type: 'JOB',
    tastingId,
    status: 'transcribing',
    completedSteps: ['ensure_job', 'start_transcription', 'extract_acoustic'],
    recordingId,
    transcribeJobName: `waganda-${tastingId}-${recordingId}`,
    attempts: 0,
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    rev: 0,
    ...overrides.job,
  });

  await repo.putRecording({
    id: recordingId,
    type: 'RECORDING',
    tastingId,
    audioKey: `uploads/${recordingId}.wav`,
    durationSec: 60,
    format: 'wav',
    acoustic: {
      rmsCurve: [0.1],
      frameSec: 0.1,
      f0Track: [
        { t: 0, hz: 100 },
        { t: 1, hz: 200 },
      ],
      silences: [],
      speechRate: 2,
      laughterCandidates: [],
      durationSec: 60,
    },
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    rev: 0,
    ...overrides.recording,
  });
}

function buildGraphWithDeps(
  repo: InMemoryRepository,
  recordingId: string,
  tastingId: string,
  agent: ReturnType<typeof createFakeAgent>,
  transcribeStatus: 'COMPLETED' | 'FAILED' = 'COMPLETED',
) {
  const s3Objects = {
    [`transcripts/${tastingId}/${recordingId}.json`]: JSON.stringify({
      results: {
        transcripts: [{ transcript: '와 신선하다' }],
        speaker_labels: {
          segments: [
            { speaker_label: 'spk_0', start_time: '0', end_time: '1' },
            { speaker_label: 'spk_1', start_time: '1', end_time: '2' },
          ],
        },
      },
    }),
  };

  return buildSessionBGraph({
    loadState: {
      repo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transcribeClient: makeFakeTranscribeClient() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s3Client: makeFakeS3Client(s3Objects) as any,
      mediaBucket: 'media-bucket',
      recordingId,
      transcribeStatus,
    },
    mapSpeakers: { repo, recordingId },
    sommelierAnalysis: {
      repo,
      agent,
      modelId: 'test-model',
      trace: startTrace('analyze_transcribed', tastingId),
      recordingId,
    },
    refreshProfile: {
      repo,
      agent,
      modelId: 'test-model',
      loadCompletedTastings: async () => [],
    },
    runDiscovery: {
      repo,
      agent,
      modelId: 'test-model',
      completedTastingCount: async () => 0,
      lastDiscoveryRunCount: async () => 0,
    },
    persistAndPublish: {
      repo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cloudFrontClient: makeFakeCloudFrontClient() as any,
      cloudFrontDistributionId: 'dist-1',
      modelId: 'test-model',
      traceId: 'trace-1',
    },
  });
}

describe('세션 B — Transcribe 완료 후 파이프라인', () => {
  it('세션 B를 중복 호출해도 분석 결과가 중복 생성되지 않는다', async () => {
    const repo = new InMemoryRepository();
    const now = new Date().toISOString();
    await repo.putTasting({
      id: 'tasting-b1',
      type: 'TASTING',
      wineId: 'wine-b1',
      lifecycle: 'polishing',
      tastedAt: now,
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });
    await seedJobAndRecording(repo, 'tasting-b1', 'rec-b1');
    const agent = createFakeAgent([VALID_SOMMELIER_OUTPUT]);
    const graph = buildGraphWithDeps(repo, 'rec-b1', 'tasting-b1', agent);

    const first = await executePipeline(graph, 'tasting-b1', {
      completedSteps: ['ensure_job', 'start_transcription', 'extract_acoustic'],
    });
    expect(first.ok).toBe(true);

    // entrypoint.ts 와 동일한 책임 분리: 그래프 노드는 Job.completedSteps 를
    // 직접 갱신하지 않으므로, 그래프 실행 후 호출부가 한 번에 병합해 저장한다.
    const jobAfterFirst = await repo.getJob('tasting-b1');
    await repo.patchJob('tasting-b1', jobAfterFirst!.rev, {
      completedSteps: [...jobAfterFirst!.completedSteps, ...first.ctx.newlyCompletedSteps],
    });

    const analysisAfterFirst = await repo.getAnalysis('tasting-b1');
    expect(analysisAfterFirst).toBeDefined();
    expect((await repo.getTasting('tasting-b1'))?.lifecycle).toBe('ready');
    // persistAndPublish 가 promptVersion 을 'unknown' 으로 폴백하던 결함의 회귀 테스트.
    // sommelierAnalysis 노드가 ctx.data['sommelierPromptVersion'] 을 세팅해야 통과한다.
    expect(analysisAfterFirst?.promptVersion).not.toBe('unknown');

    // Job 이 completed 상태이므로, entrypoint 수준에서는 재실행을 막지만
    // 그래프 자체를 completedSteps 전체로 다시 호출해도 재작성 없이 스킵된다.
    const job = await repo.getJob('tasting-b1');
    const second = await executePipeline(graph, 'tasting-b1', {
      completedSteps: job!.completedSteps,
    });
    expect(second.ok).toBe(true);
    expect(second.ctx.newlyCompletedSteps).toEqual([]);

    const analysisAfterSecond = await repo.getAnalysis('tasting-b1');
    expect(analysisAfterSecond?.rev).toBe(analysisAfterFirst?.rev);
  });

  it('트랜스크립트가 무음이어도 실패 처리하지 않는다', async () => {
    const repo = new InMemoryRepository();
    await seedJobAndRecording(repo, 'tasting-b2', 'rec-b2');

    const s3Objects = {
      'transcripts/tasting-b2/rec-b2.json': JSON.stringify({
        results: { transcripts: [{ transcript: '' }], speaker_labels: { segments: [] } },
      }),
    };

    const agent = createFakeAgent([VALID_SOMMELIER_OUTPUT]);
    const graph = buildSessionBGraph({
      loadState: {
        repo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transcribeClient: makeFakeTranscribeClient() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        s3Client: makeFakeS3Client(s3Objects) as any,
        mediaBucket: 'media-bucket',
        recordingId: 'rec-b2',
        transcribeStatus: 'COMPLETED',
      },
      mapSpeakers: { repo, recordingId: 'rec-b2' },
      sommelierAnalysis: {
        repo,
        agent,
        modelId: 'test-model',
        trace: startTrace('analyze_transcribed'),
        recordingId: 'rec-b2',
      },
      refreshProfile: { repo, agent, modelId: 'test-model', loadCompletedTastings: async () => [] },
      runDiscovery: {
        repo,
        agent,
        modelId: 'test-model',
        completedTastingCount: async () => 0,
        lastDiscoveryRunCount: async () => 0,
      },
      persistAndPublish: {
        repo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cloudFrontClient: makeFakeCloudFrontClient() as any,
        cloudFrontDistributionId: 'dist-1',
        modelId: 'test-model',
        traceId: 'trace-1',
      },
    });

    const result = await executePipeline(graph, 'tasting-b2', {
      completedSteps: ['ensure_job', 'start_transcription', 'extract_acoustic'],
    });

    // 무음이어도 load_state 는 실패하지 않고 완료 처리된다
    expect(result.ctx.newlyCompletedSteps).toContain('load_state');
    expect(result.ok).toBe(true);
  });

  it('화자분리가 실패(단일 화자)하면 화자 매핑 신뢰도가 none 이 된다', async () => {
    const repo = new InMemoryRepository();
    await seedJobAndRecording(repo, 'tasting-b3', 'rec-b3');

    const s3Objects = {
      'transcripts/tasting-b3/rec-b3.json': JSON.stringify({
        results: {
          transcripts: [{ transcript: '맛있다' }],
          speaker_labels: { segments: [{ speaker_label: 'spk_0', start_time: '0', end_time: '2' }] },
        },
      }),
    };

    const agent = createFakeAgent([VALID_SOMMELIER_OUTPUT]);
    const graph = buildSessionBGraph({
      loadState: {
        repo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transcribeClient: makeFakeTranscribeClient() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        s3Client: makeFakeS3Client(s3Objects) as any,
        mediaBucket: 'media-bucket',
        recordingId: 'rec-b3',
        transcribeStatus: 'COMPLETED',
      },
      mapSpeakers: { repo, recordingId: 'rec-b3' },
      sommelierAnalysis: {
        repo,
        agent,
        modelId: 'test-model',
        trace: startTrace('analyze_transcribed'),
        recordingId: 'rec-b3',
      },
      refreshProfile: { repo, agent, modelId: 'test-model', loadCompletedTastings: async () => [] },
      runDiscovery: {
        repo,
        agent,
        modelId: 'test-model',
        completedTastingCount: async () => 0,
        lastDiscoveryRunCount: async () => 0,
      },
      persistAndPublish: {
        repo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cloudFrontClient: makeFakeCloudFrontClient() as any,
        cloudFrontDistributionId: 'dist-1',
        modelId: 'test-model',
        traceId: 'trace-1',
      },
    });

    await executePipeline(graph, 'tasting-b3', {
      completedSteps: ['ensure_job', 'start_transcription', 'extract_acoustic'],
    });

    const recording = await repo.getRecording('tasting-b3', 'rec-b3');
    expect(recording?.speakers?.mappingConfidence).toBe('none');
    expect(recording?.speakers?.mapping).toBeNull();
  });

  it('소믈리에 출력이 스키마를 2회 재생성 후에도 위반하면 그래프가 실패로 종료된다', async () => {
    const repo = new InMemoryRepository();
    await seedJobAndRecording(repo, 'tasting-b4', 'rec-b4');

    // 항상 스키마 위반 출력만 반환하는 가짜 에이전트
    const invalidOutput = { summary: '', highlights: [], aiRating: 99, notes: {}, evidence: [] };
    const agent = createFakeAgent([invalidOutput, invalidOutput, invalidOutput]);

    const graph = buildGraphWithDeps(repo, 'rec-b4', 'tasting-b4', agent);

    const result = await executePipeline(graph, 'tasting-b4', {
      completedSteps: ['ensure_job', 'start_transcription', 'extract_acoustic'],
    });

    expect(result.ok).toBe(false);
    expect(result.ctx.error).toContain('스키마');
    // 실패 전까지의 완료 단계는 보존된다 (부분 결과 보존)
    expect(result.ctx.newlyCompletedSteps).toEqual(['load_state', 'map_speakers']);

    const analysis = await repo.getAnalysis('tasting-b4');
    expect(analysis).toBeUndefined();
  });
});
