import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateCache,
  resetCloudFrontInvalidator,
  setCloudFrontInvalidator,
  type CloudFrontInvalidator,
} from '@/lib/cache/invalidate';

describe('invalidateCache', () => {
  afterEach(() => {
    resetCloudFrontInvalidator();
    delete process.env.WAGANDA_CF_DISTRIBUTION_ID;
  });

  it('distributionId 가 없으면 no-op 으로 처리한다 (invalidated: false)', async () => {
    delete process.env.WAGANDA_CF_DISTRIBUTION_ID;
    const stub: CloudFrontInvalidator = { createInvalidation: vi.fn() };
    setCloudFrontInvalidator(stub);

    const result = await invalidateCache();

    expect(result.invalidated).toBe(false);
    expect(stub.createInvalidation).not.toHaveBeenCalled();
  });

  it('distributionId 가 있으면 /* 패턴으로 무효화를 발행한다', async () => {
    process.env.WAGANDA_CF_DISTRIBUTION_ID = 'DIST123';
    const createInvalidation = vi.fn(async () => ({ invalidationId: 'INV1' }));
    setCloudFrontInvalidator({ createInvalidation });

    const result = await invalidateCache();

    expect(result.invalidated).toBe(true);
    expect(result.invalidationId).toBe('INV1');
    expect(createInvalidation).toHaveBeenCalledWith({
      distributionId: 'DIST123',
      paths: ['/*'],
    });
  });

  it('발행이 던져도 예외를 전파하지 않고 invalidated:false 로 반환한다 (이미 커밋된 쓰기 보호)', async () => {
    // CloudFront 스로틀링·동시 무효화 한도 초과를 모사한다.
    process.env.WAGANDA_CF_DISTRIBUTION_ID = 'DIST123';
    const createInvalidation = vi.fn(async () => {
      throw new Error('TooManyInvalidationsInProgress');
    });
    setCloudFrontInvalidator({ createInvalidation });

    // 던지지 않아야 한다 — 던지면 호출한 쓰기 라우트가 성공을 500 으로 뒤집는다.
    const result = await invalidateCache();

    expect(result.invalidated).toBe(false);
    expect(result.error).toContain('TooManyInvalidationsInProgress');
  });
});
