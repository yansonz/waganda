// @vitest-environment node
/**
 * SerpAPI 키 해석 경로 테스트.
 *
 * 키는 선택 항목이다. 배포 환경에서는 SSM SecureString 에서 읽고, 없으면 검색 없이 보강한다.
 * 여기서 고정하는 사양:
 * - 환경변수가 있으면 SSM 을 건드리지 않는다 (로컬·테스트 경로)
 * - 테스트 모드에서는 절대 SSM 을 호출하지 않는다 (네트워크·요금 차단)
 * - 인증 시크릿 조회와 분리되어 있어, 검색 키가 없어도 인증 설정 조회가 깨지지 않는다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSearchApiKey, resetConfigCache } from '@/lib/config';
import { resolveSearchProvider } from '@/lib/search/serpapi';

const ORIGINAL_KEY = process.env.SERPAPI_KEY;

beforeEach(() => {
  resetConfigCache();
  delete process.env.SERPAPI_KEY;
});

afterEach(() => {
  resetConfigCache();
  vi.restoreAllMocks();
  if (ORIGINAL_KEY === undefined) delete process.env.SERPAPI_KEY;
  else process.env.SERPAPI_KEY = ORIGINAL_KEY;
});

describe('getSearchApiKey', () => {
  it('환경변수 SERPAPI_KEY 가 있으면 그 값을 쓴다', async () => {
    process.env.SERPAPI_KEY = 'env-key';

    await expect(getSearchApiKey()).resolves.toBe('env-key');
  });

  it('테스트 모드에서 키가 없으면 SSM 을 호출하지 않고 undefined 를 돌려준다', async () => {
    // vitest.setup 이 WAGANDA_TEST_MODE=1 을 넣으므로 이 실행은 테스트 모드다.
    // SSM 을 호출하면 네트워크를 타므로, 호출하지 않는 것 자체가 사양이다.
    const ssm = await import('@aws-sdk/client-ssm');
    const sendSpy = vi.spyOn(ssm.SSMClient.prototype, 'send');

    await expect(getSearchApiKey()).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('resolveSearchProvider', () => {
  it('키가 없으면 프로바이더를 만들지 않는다 (보강은 검색 없이 진행)', async () => {
    await expect(resolveSearchProvider()).resolves.toBeUndefined();
  });

  it('키가 있으면 프로바이더를 만들고, 테스트 모드에서는 실제 호출이 차단된다', async () => {
    process.env.SERPAPI_KEY = 'env-key';

    const provider = await resolveSearchProvider();
    expect(provider).toBeTypeOf('function');

    // 유료 API 다 — 테스트에서 실제로 호출되면 요금이 발생하므로 가드가 동기로 던져야 한다.
    expect(() => provider?.('barolo 2016')).toThrow(/테스트 모드/);
  });
});
