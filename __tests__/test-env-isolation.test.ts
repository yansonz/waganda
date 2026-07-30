// @vitest-environment node
/**
 * 테스트 환경 격리 회귀 테스트.
 *
 * `vitest.setup.ts` 가 기본값을 `??=` 로 넣던 탓에 `.env.local` 을 읽은 셸에서 실행하면
 * 개발자의 실제 값(`APP_BASE_URL=http://localhost:3000`, 실제 편집자 이메일 등)이 우선해
 * **로컬에서만 66건이 실패**했다. CI 는 통과하므로 원인을 찾기 어려운 형태였다.
 *
 * 테스트는 실행 환경과 무관하게 같은 결과를 내야 한다. 그 조건을 여기서 고정한다.
 */
import { describe, expect, it } from 'vitest';

describe('테스트 환경 격리', () => {
  it('인증 설정은 셸·.env.local 값과 무관하게 고정된다', () => {
    // 픽스처는 @example.com 을 쓴다(실제 이메일을 저장소에 두지 않는다).
    expect(process.env.EDITOR_ALLOWLIST).toBe('yan@example.com,robert@example.com');
    // Origin 동일 출처 검증(`lib/auth/guard.ts`)의 기준값이다.
    expect(process.env.APP_BASE_URL).toBe('https://waganda.test');
    // https 여야 쿠키 Secure 속성이 켜진 상태로 검증된다.
    expect(process.env.APP_BASE_URL?.startsWith('https://')).toBe(true);
    expect(process.env.WAGANDA_ENV).toBe('test');
    expect(process.env.WAGANDA_TABLE_NAME).toBe('waganda-test');
  });

  it('과금·로컬 전용 설정은 테스트에 남아 있지 않다', () => {
    // 유료 API 키와 실제 AWS 자격증명
    for (const key of [
      'SERPAPI_KEY',
      'AWS_PROFILE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
    ]) {
      expect(process.env[key], `${key} 가 테스트에 남아 있다`).toBeUndefined();
    }

    // 로컬 에뮬레이터·모델 지정 — 남으면 테스트가 실제 엔드포인트를 향한다
    for (const key of [
      'WAGANDA_DDB_ENDPOINT',
      'WAGANDA_S3_ENDPOINT',
      'WAGANDA_BEDROCK_MODEL_ID',
      'WAGANDA_LABEL_FALLBACK',
      'WAGANDA_LOCAL_PIPELINE',
      'WAGANDA_TRANSCRIBE_BUCKET',
      'WAGANDA_AGENT_RUNTIME_ARN',
      'WAGANDA_SSM_PREFIX',
    ]) {
      expect(process.env[key], `${key} 가 테스트에 남아 있다`).toBeUndefined();
    }
  });

  it('테스트 모드 표시가 켜져 있어 과금 호출이 차단된다', () => {
    expect(process.env.WAGANDA_TEST_MODE).toBe('1');
  });
});
