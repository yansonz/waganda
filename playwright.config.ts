import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 설정.
 *
 * globalSetup 이 DynamoDB Local 컨테이너를 띄우고 시드를 넣은 뒤,
 * webServer 로 띄운 Next 앱에 **같은 엔드포인트와 테이블 이름**을 주입한다.
 * 그래야 공개 화면이 실제 데이터 경로를 통해 렌더된다.
 */
const DDB_ENDPOINT = 'http://127.0.0.1:9000';
/*
 * E2E 는 **별도 테이블**을 쓴다. 개발용 테이블(waganda-local)을 공유하면
 * 시드·삭제 테스트가 직접 기록한 시음을 지워 버린다.
 */
const TABLE_NAME = 'waganda-e2e';
const BASE_URL = 'http://127.0.0.1:3100';
const S3_ENDPOINT = 'http://127.0.0.1:4570';

export default defineConfig({
  testDir: 'e2e',
  globalTeardown: 'e2e/global-teardown.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  webServer: {
    // Playwright 는 webServer 를 globalSetup 보다 먼저 띄우므로,
    // DynamoDB Local 기동·시드를 같은 명령 체인 앞단에서 수행한다.
    command: 'npx tsx e2e/fixtures/prepare.ts && npx next start -p 3100',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      WAGANDA_ENV: 'local',
      /*
       * 과금되는 외부 호출을 차단한다 (lib/aws/testGuard.ts).
       * E2E 는 화면·API 계약을 검증하는 자리이고, 모델·전사 품질은 로컬 수동 확인에서 본다.
       */
      WAGANDA_TEST_MODE: '1',
      // 사전 서명이 실제 S3 를 향하지 않게 로컬 S3 를 가리킨다
      WAGANDA_S3_ENDPOINT: S3_ENDPOINT,
      // E2E 는 같은 IP 에서 수백 건을 호출하므로 앱 계층 속도 제한을 넉넉히 둔다
      WAGANDA_RATE_LIMIT_MAX: '10000',
      AWS_REGION: 'ap-northeast-2',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
      WAGANDA_DDB_ENDPOINT: DDB_ENDPOINT,
      WAGANDA_TABLE_NAME: TABLE_NAME,
      WAGANDA_MEDIA_BUCKET: 'waganda-media-local',
      APP_BASE_URL: BASE_URL,
      GOOGLE_CLIENT_ID: 'local-client-id',
      GOOGLE_CLIENT_SECRET: 'local-client-secret',
      EDITOR_JWT_SECRET: 'local-jwt-secret-must-be-at-least-32-bytes-long!!',
      EDITOR_ALLOWLIST: 'yan@example.com,robert@example.com',
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // 모바일 375px 폭 렌더링 검증 (R9)
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
