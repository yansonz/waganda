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

process.env.WAGANDA_ENV ??= 'test';
process.env.WAGANDA_TABLE_NAME ??= 'waganda-test';
process.env.WAGANDA_MEDIA_BUCKET ??= 'waganda-media-test';
process.env.AWS_REGION ??= 'ap-northeast-2';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
process.env.EDITOR_JWT_SECRET ??= 'test-jwt-secret-must-be-at-least-32-bytes-long!!';
process.env.EDITOR_ALLOWLIST ??= 'yan@example.com,robert@example.com';
process.env.APP_BASE_URL ??= 'https://waganda.test';

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
