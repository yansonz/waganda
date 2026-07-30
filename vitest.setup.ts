import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 테스트 기본 환경변수 — lib/config.ts 가 미설정 시 즉시 실패하도록 설계되어 있으므로
// 단위 테스트에서는 결정론적인 더미 값을 주입한다.
/*
 * 테스트 모드 표시 — 과금되는 외부 호출(Bedrock·Transcribe·SerpAPI·실제 S3)을 차단한다.
 * (lib/aws/testGuard.ts). 테스트는 의존성을 주입해 스텁으로 대체한다.
 */
process.env.WAGANDA_TEST_MODE = '1';

/*
 * 개발자 셸의 실제 AWS 자격증명·유료 API 키가 테스트로 새어 들어오지 않게 지운다.
 * 가드가 이미 막지만, 실수로 가드를 우회하는 경로가 생겨도 인증 자체가 안 되게 이중으로 둔다.
 */
delete process.env.AWS_PROFILE;
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SESSION_TOKEN;
delete process.env.SERPAPI_KEY;
delete process.env.WAGANDA_AGENT_RUNTIME_ARN;
delete process.env.WAGANDA_LABEL_FALLBACK;
delete process.env.WAGANDA_LOCAL_PIPELINE;
delete process.env.WAGANDA_TRANSCRIBE_BUCKET;
/*
 * 로컬 개발 설정도 지운다 — 남아 있으면 테스트가 에뮬레이터·실제 모델을 향하거나
 * 기본값 검증이 어긋난다.
 */
delete process.env.WAGANDA_DDB_ENDPOINT;
delete process.env.WAGANDA_S3_ENDPOINT;
delete process.env.WAGANDA_BEDROCK_MODEL_ID;
delete process.env.WAGANDA_SSM_PREFIX;
delete process.env.WAGANDA_CF_DISTRIBUTION_ID;
delete process.env.EDITOR_SESSION_TTL_SEC;
delete process.env.WAGANDA_DAILY_AGENT_RUN_LIMIT;
delete process.env.WAGANDA_MONTHLY_MODEL_BUDGET_USD;

/*
 * 테스트 기본 설정은 **덮어쓴다**(`??=` 아님).
 *
 * `??=` 로 두면 `.env.local` 을 읽은 셸에서 실행할 때 개발자의 실제 값이 우선해
 * 로컬에서만 실패하는 테스트가 된다. 실제로 `APP_BASE_URL=http://localhost:3000`,
 * 실제 편집자 이메일이 담긴 `EDITOR_ALLOWLIST` 가 스며들어 66건이 깨졌다.
 * 테스트는 실행 환경과 무관하게 같은 결과를 내야 한다.
 */
process.env.WAGANDA_ENV = 'test';
process.env.WAGANDA_TABLE_NAME = 'waganda-test';
process.env.WAGANDA_MEDIA_BUCKET = 'waganda-media-test';
process.env.AWS_REGION = 'ap-northeast-2';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.EDITOR_JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-bytes-long!!';
process.env.EDITOR_ALLOWLIST = 'yan@example.com,robert@example.com';
process.env.APP_BASE_URL = 'https://waganda.test';

// jsdom 에 없는 브라우저 API 보강
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-4000-8000-000000000000',
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
