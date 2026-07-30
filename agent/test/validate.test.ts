import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validateWithRetry } from '../src/lib/validate.js';

const Schema = z.object({ value: z.number().min(1).max(5) });

describe('lib/validate — 구조화 출력 검증 + 재생성 재시도', () => {
  it('첫 시도에 유효한 결과를 반환하면 재시도 없이 성공한다', async () => {
    const generate = vi.fn().mockResolvedValue({ value: 3 });
    const result = await validateWithRetry({ schema: Schema, generate });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('처음 위반해도 재생성 후 유효해지면 성공한다', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ value: 99 })
      .mockResolvedValueOnce({ value: 4 });
    const result = await validateWithRetry({ schema: Schema, generate });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('최대 2회 재생성(총 3회 시도) 후에도 위반하면 실패로 반환한다', async () => {
    const generate = vi.fn().mockResolvedValue({ value: -1 });
    const result = await validateWithRetry({ schema: Schema, generate });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.lastError).toBeDefined();
  });
});
