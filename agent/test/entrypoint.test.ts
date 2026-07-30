import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * entrypoint.ts 는 모듈 로드 시점에 process.env 를 읽어 상수를 고정하므로,
 * 환경변수를 먼저 설정한 뒤 동적 import 로 모듈을 로드해야 한다.
 */
async function loadEntrypoint() {
  process.env['NODE_ENV'] = 'test';
  process.env['AWS_REGION'] = 'us-west-2';
  process.env['MODEL_INFERENCE_PROFILE_ARN'] = 'arn:aws:bedrock:us-west-2:123:inference-profile/test';
  process.env['MEDIA_BUCKET'] = 'media-bucket';
  process.env['DAILY_RUN_LIMIT'] = '9999';
  process.env['MONTHLY_BUDGET_USD'] = '9999';
  // 매 테스트마다 독립된 모듈 인스턴스를 얻기 위해 캐시를 비운다
  vi.resetModules();
  return import('../src/entrypoint.js');
}

describe('entrypoint — AgentInvocation 요청 검증 및 예외 처리', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('스키마에 맞지 않는 요청 본문은 예외를 던지고 500 상당의 한국어 사유를 포함한다', async () => {
    const { handleInvocation } = await loadEntrypoint();
    await expect(handleInvocation(JSON.stringify({ task: 'unknown_task' }))).rejects.toThrow(
      /스키마 검증에 실패/,
    );
  });

  it('JSON 형식이 아닌 본문은 명확한 한국어 사유로 실패한다', async () => {
    const { handleInvocation } = await loadEntrypoint();
    await expect(handleInvocation('not-json')).rejects.toThrow(/JSON/);
  });

  it('analyze_upload 요청은 필수 필드(tastingId, recordingId, audioKey)가 있어야 한다', async () => {
    const { handleInvocation } = await loadEntrypoint();
    await expect(
      handleInvocation(JSON.stringify({ task: 'analyze_upload', tastingId: 'tasting-1' })),
    ).rejects.toThrow(/스키마 검증에 실패/);
  });
});
