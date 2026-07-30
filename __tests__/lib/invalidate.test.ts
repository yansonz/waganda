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
});
