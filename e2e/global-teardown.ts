/**
 * E2E 종료 처리.
 *
 * **컨테이너를 지우지 않는다.** 예전에는 정리 차원에서 지웠는데,
 * DynamoDB Local 이 in-memory 라 개발 중 직접 기록한 시음까지 함께 사라졌다.
 * E2E 는 별도 테이블(waganda-e2e)만 쓰므로 컨테이너를 남겨 두어도 서로 간섭하지 않는다.
 *
 * 컨테이너를 정리하려면 `npm run db:down` 을 명시적으로 실행한다.
 */
async function globalTeardown(): Promise<void> {
  console.log('[e2e] 완료 — 로컬 DB 컨테이너는 유지한다 (개발 데이터 보존)');
}

export default globalTeardown;
