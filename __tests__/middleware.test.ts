// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDocClient, setDocClient } from '@/lib/db/client';

/**
 * middleware.ts 단위 테스트 — /api/* 속도 제한 적용 (15.4).
 * DynamoDB 는 setDocClient 스텁으로 대체한다.
 */

function createMockDocClient() {
  return { send: vi.fn() };
}

function makeRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest(new URL('https://waganda.test/api/wines'), {
    method: 'GET',
    headers,
  });
}

describe('middleware — /api/* 속도 제한', () => {
  let mockClient: ReturnType<typeof createMockDocClient>;

  beforeEach(() => {
    mockClient = createMockDocClient();
    setDocClient(mockClient as never);
  });

  afterEach(() => {
    resetDocClient();
    vi.clearAllMocks();
  });

  it('상한 이하이면 요청을 통과시킨다', async () => {
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1 } });

    const middleware = (await import('@/middleware')).default;
    const response = await middleware(makeRequest({ 'x-forwarded-for': '203.0.113.1' }));

    expect(response.status).toBe(200); // NextResponse.next() 의 기본 status
  });

  it('상한을 초과하면 429 로 차단한다', async () => {
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1000 } });

    const middleware = (await import('@/middleware')).default;
    const response = await middleware(makeRequest({ 'x-forwarded-for': '203.0.113.2' }));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('윈도우가 만료된 이후에는 다시 통과된다 (새 윈도우 카운터)', async () => {
    // 첫 요청: 상한 초과
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1000 } });
    const middleware = (await import('@/middleware')).default;
    const blocked = await middleware(makeRequest({ 'x-forwarded-for': '203.0.113.3' }));
    expect(blocked.status).toBe(429);

    // 다음 윈도우: 카운터가 리셋된 것처럼 낮은 값
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1 } });
    const allowed = await middleware(makeRequest({ 'x-forwarded-for': '203.0.113.3' }));
    expect(allowed.status).toBe(200);
  });

  it('속도 제한 인프라 장애 시에는 요청을 막지 않고 통과시킨다', async () => {
    mockClient.send.mockRejectedValueOnce(new Error('DynamoDB 장애'));

    const middleware = (await import('@/middleware')).default;
    const response = await middleware(makeRequest({ 'x-forwarded-for': '203.0.113.4' }));

    expect(response.status).toBe(200);
  });

  it('IP 는 해싱되어 pk 에 원문으로 노출되지 않는다', async () => {
    mockClient.send.mockResolvedValueOnce({ Attributes: { count: 1 } });

    const middleware = (await import('@/middleware')).default;
    await middleware(makeRequest({ 'x-forwarded-for': '203.0.113.5' }));

    const sentCommand = mockClient.send.mock.calls[0][0];
    expect(sentCommand.input.Key.pk).not.toContain('203.0.113.5');
    expect(sentCommand.input.Key.pk).toMatch(/^RATE#[a-f0-9]{64}$/);
  });
});
