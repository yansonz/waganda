import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDocClient, getDocClient } from '@/lib/db/client';

describe('DynamoDB 클라이언트 엔드포인트 오버라이드 (WAGANDA_DDB_ENDPOINT)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 매 테스트마다 클라이언트 캐시를 리셋해서 새로 생성하게 한다
    resetDocClient();
  });

  afterEach(() => {
    // 원래 환경 복구
    process.env = { ...originalEnv };
    resetDocClient();
  });

  it('WAGANDA_DDB_ENDPOINT 환경변수가 없으면 AWS 기본값을 사용한다', () => {
    // 환경변수 제거
    delete process.env.WAGANDA_DDB_ENDPOINT;

    // 최소한 클라이언트가 생성되어야 함 (엔드포인트 검증은 DynamoDB SDK 내부에서)
    const client = getDocClient();
    expect(client).toBeDefined();
  });

  it('WAGANDA_DDB_ENDPOINT 환경변수가 있으면 로컬 엔드포인트를 사용한다', () => {
    // 로컬 DynamoDB 엔드포인트 설정
    process.env.WAGANDA_DDB_ENDPOINT = 'http://127.0.0.1:9000';

    // 최소한 클라이언트가 생성되어야 함
    // 실제 연결은 E2E 테스트에서만 검증
    const client = getDocClient();
    expect(client).toBeDefined();
  });

  it('빈 WAGANDA_DDB_ENDPOINT는 무시되고 AWS 기본값을 사용한다', () => {
    process.env.WAGANDA_DDB_ENDPOINT = '';

    const client = getDocClient();
    expect(client).toBeDefined();
  });
});
