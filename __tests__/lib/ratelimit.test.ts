import { describe, expect, it, vi } from 'vitest';
import { checkRateLimit, currentWindow, hashIp, extractClientIp } from '@/lib/ratelimit';

function createMockDocClient() {
  return { send: vi.fn() };
}

describe('hashIp', () => {
  it('IP 원문을 그대로 노출하지 않고 해싱한다', () => {
    const hashed = hashIp('203.0.113.1');
    expect(hashed).not.toBe('203.0.113.1');
    expect(hashed).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('같은 IP 는 항상 같은 해시를 생성한다(결정론적)', () => {
    expect(hashIp('203.0.113.1')).toBe(hashIp('203.0.113.1'));
  });

  it('다른 IP 는 다른 해시를 생성한다', () => {
    expect(hashIp('203.0.113.1')).not.toBe(hashIp('203.0.113.2'));
  });
});

describe('currentWindow', () => {
  it('같은 윈도우 내의 시각은 동일한 윈도우 식별자를 반환한다', () => {
    const t0 = new Date('2025-01-01T00:00:00.000Z').getTime();
    const t1 = new Date('2025-01-01T00:00:30.000Z').getTime();
    expect(currentWindow(t0, 60)).toBe(currentWindow(t1, 60));
  });

  it('윈도우가 지나면 다른 식별자를 반환한다', () => {
    const t0 = new Date('2025-01-01T00:00:00.000Z').getTime();
    const t1 = new Date('2025-01-01T00:01:01.000Z').getTime();
    expect(currentWindow(t0, 60)).not.toBe(currentWindow(t1, 60));
  });
});

describe('extractClientIp', () => {
  it('x-forwarded-for 첫 번째 항목을 사용한다', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });
    expect(extractClientIp(headers)).toBe('203.0.113.1');
  });

  it('x-forwarded-for 가 없으면 x-real-ip 를 사용한다', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.9' });
    expect(extractClientIp(headers)).toBe('203.0.113.9');
  });

  it('둘 다 없으면 unknown 을 반환한다', () => {
    expect(extractClientIp(new Headers())).toBe('unknown');
  });
});

describe('checkRateLimit — 조건부 증가 + TTL', () => {
  it('상한 이하이면 허용하고 카운트를 증가시킨다', async () => {
    const mockClient = createMockDocClient();
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1 } });

    const result = await checkRateLimit('hashed-ip', {
      client: mockClient as never,
      tableName: 'waganda-test',
      maxRequests: 5,
    });

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });

  it('상한을 초과하면 차단한다', async () => {
    const mockClient = createMockDocClient();
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 6 } });

    const result = await checkRateLimit('hashed-ip', {
      client: mockClient as never,
      tableName: 'waganda-test',
      maxRequests: 5,
    });

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(6);
  });

  it('ADD 표현식으로 원자적 증가를 요청한다', async () => {
    const mockClient = createMockDocClient();
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1 } });

    await checkRateLimit('hashed-ip', { client: mockClient as never, tableName: 'waganda-test' });

    const sentCommand = mockClient.send.mock.calls[0][0];
    expect(sentCommand.input.UpdateExpression).toContain('ADD');
    expect(sentCommand.input.Key.pk).toBe('RATE#hashed-ip');
  });

  it('윈도우가 만료되면(다른 시각) 새 카운터로 다시 허용한다', async () => {
    const mockClient = createMockDocClient();
    // 첫 윈도우: 상한 초과
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 10 } });
    const first = await checkRateLimit('hashed-ip', {
      client: mockClient as never,
      tableName: 'waganda-test',
      maxRequests: 5,
      windowSec: 60,
      now: new Date('2025-01-01T00:00:00.000Z'),
    });
    expect(first.allowed).toBe(false);

    // 다음 윈도우: 카운터가 리셋된 것처럼 새로 1부터 시작
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1 } });
    const second = await checkRateLimit('hashed-ip', {
      client: mockClient as never,
      tableName: 'waganda-test',
      maxRequests: 5,
      windowSec: 60,
      now: new Date('2025-01-01T00:01:01.000Z'),
    });
    expect(second.allowed).toBe(true);

    // 서로 다른 sk(윈도우) 로 호출되었는지 확인
    const firstSk = mockClient.send.mock.calls[0][0].input.Key.sk;
    const secondSk = mockClient.send.mock.calls[1][0].input.Key.sk;
    expect(firstSk).not.toBe(secondSk);
  });
});
