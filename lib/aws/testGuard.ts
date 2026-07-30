/**
 * lib/aws/testGuard.ts — 테스트에서 과금되는 외부 호출을 막는 가드.
 *
 * 배경: 라벨 인식·소믈리에 분석·트랜스크립션·검색은 실제 호출 시 요금이 붙는다.
 * 단위·E2E 테스트는 이 경로를 **스텁으로 대체**하는 것이 규칙인데,
 * 주입을 잊으면 조용히 실제 AWS·SerpAPI 를 호출해 요금이 새어 나간다.
 *
 * 그래서 기본 구현(주입되지 않은 경로)은 실행 전에 이 가드를 통과해야 한다.
 * 테스트 모드에서는 호출 대신 **명확한 오류**를 던져 어디서 주입이 빠졌는지 알린다.
 *
 * 판별 기준 (하나라도 해당하면 테스트 모드)
 * - `VITEST` — vitest 가 자동으로 설정한다
 * - `NODE_ENV=test`
 * - `WAGANDA_TEST_MODE=1` — Playwright 가 띄우는 서버에 명시적으로 넣는다
 *
 * 로컬에서 직접 확인할 때(`npm run dev`, `npm run analyze:local`)는 이 조건에 걸리지 않으므로
 * 실제 Bedrock·S3·Transcribe·SerpAPI 를 그대로 사용한다.
 */

/** 테스트 모드 여부 */
export function isTestMode(): boolean {
  return (
    process.env.VITEST !== undefined ||
    process.env.NODE_ENV === 'test' ||
    process.env.WAGANDA_TEST_MODE === '1'
  );
}

/**
 * 과금되는 외부 호출 직전에 부른다.
 * 테스트 모드면 던진다 — 테스트는 스텁을 주입해야 한다.
 */
export function assertExternalCallAllowed(label: string): void {
  if (!isTestMode()) return;

  throw new Error(
    `[테스트 모드] ${label} 실제 호출이 차단되었습니다. ` +
      '테스트는 의존성을 주입해 스텁으로 대체해야 합니다 ' +
      '(요금이 발생하는 호출을 테스트에서 수행하지 않습니다).',
  );
}
