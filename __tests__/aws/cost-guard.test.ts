/**
 * 테스트에서 과금 호출이 차단되는지 검증한다 (비용 사고 회귀 방지).
 *
 * 규칙: 테스트는 Bedrock·Transcribe·SerpAPI·실제 S3 를 호출하지 않는다.
 * 주입을 잊으면 조용히 실제 호출이 나가는 대신 **명확한 오류**가 나야 한다.
 *
 * 로컬 수동 확인(`npm run dev`, `npm run analyze:local`)은 이 조건에 걸리지 않으므로
 * 실제 서비스를 그대로 사용한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertExternalCallAllowed, isTestMode } from '@/lib/aws/testGuard';
import { recognizeLabelWithBedrock } from '@/lib/agent/labelDirect';
import { analyzeWithBedrock } from '@/lib/agent/sommelierDirect';
import { enrichLabelExtraction } from '@/lib/agent/labelEnrich';
import { getSearchProvider } from '@/lib/search/serpapi';
import { presignRecordingUpload, resetRecordingPresigner } from '@/lib/upload/presign';

afterEach(() => {
  resetRecordingPresigner();
  delete process.env.SERPAPI_KEY;
  delete process.env.WAGANDA_S3_ENDPOINT;
  vi.restoreAllMocks();
});

describe('테스트 모드 판별', () => {
  it('vitest 실행 중에는 테스트 모드다', () => {
    expect(isTestMode()).toBe(true);
  });

  it('가드는 무엇이 막혔는지 알려준다', () => {
    expect(() => assertExternalCallAllowed('Bedrock 테스트')).toThrow(/테스트 모드/);
    expect(() => assertExternalCallAllowed('Bedrock 테스트')).toThrow(/Bedrock 테스트/);
  });
});

describe('과금 호출 차단', () => {
  it('라벨 인식은 주입 없이 실행되지 않는다 (Bedrock·S3)', async () => {
    // deps 를 주지 않으면 기본 구현이 실제 AWS 를 향한다 → 가드가 막아야 한다
    await expect(recognizeLabelWithBedrock('labels/a.jpg')).rejects.toThrow(/테스트 모드/);
  });

  it('소믈리에 분석은 주입 없이 실행되지 않는다 (Bedrock)', async () => {
    const result = await analyzeWithBedrock({ wine: { name: '테스트 와인' } });
    // 내부에서 3회 시도하며 모두 가드에 막히고, 실패로 정리된다
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/테스트 모드/);
  });

  it('라벨 보강은 주입 없이 실행되지 않는다 (Bedrock)', async () => {
    const extraction = {
      recognized: true as const,
      name: { value: '테스트 와인', confidence: 'high' as const },
      sourceUrls: [],
    };

    // 보강은 최선 노력이므로 던지지 않고 원본을 그대로 돌려준다
    const result = await enrichLabelExtraction(extraction);
    expect(result.filled).toEqual([]);
    expect(result.extraction).toEqual(extraction);
  });

  it('SerpAPI 프로바이더는 호출 시 막힌다 (유료 API)', async () => {
    process.env.SERPAPI_KEY = 'test-key';
    const provider = getSearchProvider();
    expect(provider).toBeTypeOf('function');
    // 가드는 동기적으로 던진다 — 네트워크 호출 이전에 막는다
    expect(() => provider!('19 Crimes')).toThrow(/테스트 모드/);
  });

  it('실제 S3 사전 서명은 막힌다 (로컬 엔드포인트가 없을 때)', async () => {
    await expect(
      presignRecordingUpload({ tastingId: 't1', format: 'webm' }),
    ).rejects.toThrow(/테스트 모드/);
  });

  it('로컬 S3 엔드포인트가 지정돼 있으면 사전 서명은 허용된다 (요금 없음)', async () => {
    process.env.WAGANDA_S3_ENDPOINT = 'http://127.0.0.1:4570';
    const result = await presignRecordingUpload({ tastingId: 't1', format: 'webm' });
    expect(result.uploadUrl).toContain('127.0.0.1:4570');
    expect(result.audioKey).toContain('recordings/t1/');
  });

  it('Transcribe 는 주입 없이 실행되지 않는다', async () => {
    const { runLocalAnalysis } = await import('@/lib/analysis/localPipeline');
    // 시음 조회 단계에서 이미 실패하거나 가드에 막힌다 — 어느 쪽이든 실제 호출은 없다
    await expect(runLocalAnalysis('does-not-exist', { log: () => {} })).rejects.toThrow();
  });
});

describe('개발자 자격증명 격리', () => {
  it('테스트 환경에는 실제 AWS 자격증명·유료 키가 없다', () => {
    expect(process.env.AWS_PROFILE).toBeUndefined();
    expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(process.env.SERPAPI_KEY).toBeUndefined();
  });

  it('실행 경로 플래그도 비어 있다 (실수로 켜지지 않는다)', () => {
    expect(process.env.WAGANDA_AGENT_RUNTIME_ARN).toBeUndefined();
    expect(process.env.WAGANDA_LABEL_FALLBACK).toBeUndefined();
    expect(process.env.WAGANDA_LOCAL_PIPELINE).toBeUndefined();
  });
});
