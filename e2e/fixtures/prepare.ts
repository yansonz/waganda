/**
 * E2E 준비 — DynamoDB Local 기동 + 시드.
 *
 * Playwright 는 `webServer` 를 `globalSetup` **보다 먼저** 띄운다.
 * 그래서 준비 작업을 globalSetup 에 두면 앱이 DB 없이 먼저 떠서 실패한다.
 * 이 스크립트를 `webServer.command` 앞단에 붙여 순서를 보장한다.
 *
 * 기동 로직은 `scripts/local-ddb.ts` 와 공유한다 (로컬 개발과 동일한 경로).
 */
import { ensureLocalDdb } from '../../scripts/local-ddb';
import { ensureLocalS3 } from '../../scripts/local-s3';

// E2E 전용 테이블 — 개발 데이터(waganda-local)와 분리한다
process.env.WAGANDA_TABLE_NAME = 'waganda-e2e';
// 알려진 상태에서 시작한다 (누적된 테스트 데이터 제거) — 개발 테이블은 대상이 아니다
process.env.WAGANDA_SEED_RESET = '1';

Promise.all([ensureLocalDdb(), ensureLocalS3()]).catch((error: unknown) => {
  console.error('[e2e] 준비 실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
