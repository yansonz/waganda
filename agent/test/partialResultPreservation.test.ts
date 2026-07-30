import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from './helpers/inMemoryRepository.js';
import { createFakeAgent } from './helpers/fakeAgent.js';
import { buildSessionBGraph } from '../src/graph/sessionB.js';
import { executePipeline } from '../src/graph/executor.js';
import { startTrace } from '../src/lib/trace.js';

/**
 * design.md '가드레일 중단' — 상한(여기서는 스키마 검증 재시도 상한)에 도달해
 * 그래프가 실패로 종료되어도, 이미 완료된 단계의 부산물(트랜스크립트 적재,
 * 화자 매핑)은 원본 오디오와 함께 그대로 보존되어야 한다. Analysis 는 아직
 * 쓰이지 않아야 한다 — persistAndPublish 가 실행되지 않았기 때문이다.
 */
describe('가드레일 중단 시 부분 결과 보존', () => {
  it('sommelier_analysis 가 반복 실패해도 load_state·map_speakers 의 결과는 저장소에 남는다', async () => {
    const repo = new InMemoryRepository();
    const now = new Date().toISOString();
    await repo.putJob({
      type: 'JOB',
      tastingId: 'tasting-partial',
      status: 'transcribing',
      completedSteps: ['ensure_job', 'start_transcription', 'extract_acoustic'],
      recordingId: 'rec-partial',
      transcribeJobName: 'waganda-tasting-partial-rec-partial',
      attempts: 0,
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });
    await repo.putRecording({
      id: 'rec-partial',
      type: 'RECORDING',
      tastingId: 'tasting-partial',
      audioKey: 'uploads/rec-partial.wav',
      durationSec: 30,
      format: 'wav',
      transcript: { language: 'ko-KR', fullText: '괜찮네요', segments: [] },
      acoustic: {
        rmsCurve: [0.1],
        frameSec: 0.1,
        f0Track: [{ t: 0, hz: 150 }],
        silences: [],
        speechRate: 1,
        laughterCandidates: [],
        durationSec: 30,
      },
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    });

    // 항상 스키마를 위반하는 출력만 반환 — 2회 재생성 후에도 실패해 그래프가 중단된다
    const invalidOutput = { summary: '', highlights: [], aiRating: 99, notes: {}, evidence: [] };
    const agent = createFakeAgent([invalidOutput, invalidOutput, invalidOutput]);

    const graph = buildSessionBGraph({
      loadState: {
        repo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transcribeClient: { send: async () => ({}) } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        s3Client: { send: async () => ({}) } as any,
        mediaBucket: 'media-bucket',
        recordingId: 'rec-partial',
        transcribeStatus: 'COMPLETED',
      },
      mapSpeakers: { repo, recordingId: 'rec-partial' },
      sommelierAnalysis: {
        repo,
        agent,
        modelId: 'test-model',
        trace: startTrace('analyze_transcribed'),
        recordingId: 'rec-partial',
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
        cloudFrontClient: { send: async () => ({}) } as any,
        cloudFrontDistributionId: 'dist-1',
        modelId: 'test-model',
        traceId: 'trace-1',
      },
    });

    const result = await executePipeline(graph, 'tasting-partial', {
      completedSteps: ['ensure_job', 'start_transcription', 'extract_acoustic'],
    });

    expect(result.ok).toBe(false);

    // 부분 결과 보존 확인: 원본 녹음(오디오 키·트랜스크립트·음향특징·화자매핑)은 그대로 남는다
    const recording = await repo.getRecording('tasting-partial', 'rec-partial');
    expect(recording?.audioKey).toBe('uploads/rec-partial.wav');
    expect(recording?.transcript?.fullText).toBe('괜찮네요');
    expect(recording?.acoustic).toBeDefined();
    expect(recording?.speakers).toBeDefined(); // map_speakers 는 완료되었으므로 존재

    // Analysis 는 persist_and_publish 가 실행되지 않았으므로 아직 쓰이지 않는다
    const analysis = await repo.getAnalysis('tasting-partial');
    expect(analysis).toBeUndefined();

    // Job 은 여전히 존재하며(격리·삭제되지 않음) 재분석 버튼을 위한 상태 조회가 가능하다
    const job = await repo.getJob('tasting-partial');
    expect(job).toBeDefined();
    expect(job?.status).toBe('transcribing');
  });
});
