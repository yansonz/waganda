/**
 * AgentCore Runtime HTTP 계약 테스트.
 *
 * 런타임은 컨테이너에 `GET /ping` 과 `POST /invocations` 만 보낸다.
 * 특히 `/ping` 응답의 `status` 는 **`Healthy` 또는 `HealthyBusy`** 여야 한다 —
 * 소문자 `healthy` 를 돌려주자 런타임이 컨테이너를 준비 상태로 인정하지 않고
 * `POST /invocations` 를 아예 보내지 않았다. 호출자는 `RuntimeClientError` 만 받고
 * CloudWatch 로그에도 요청이 남지 않아 원인을 찾기 어려웠다.
 *
 * 이 계약이 깨지면 분석 파이프라인 전체가 조용히 멈추므로 테스트로 고정한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { server } from '../src/entrypoint.js';

let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('GET /ping', () => {
  it('200 과 status=Healthy 를 돌려준다 (AgentCore 계약)', async () => {
    const response = await fetch(`${baseUrl}/ping`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = (await response.json()) as { status?: string };
    // 런타임이 인정하는 값은 이 둘뿐이다. 소문자·다른 문자열은 준비 상태로 취급되지 않는다.
    expect(['Healthy', 'HealthyBusy']).toContain(body.status);
  });

  it('상태 변경이 없을 때 time_of_last_update 를 보내지 않는다', async () => {
    // 매 ping 마다 타임스탬프가 바뀌면 런타임이 상태가 계속 변한다고 보아
    // 유휴 세션 타임아웃이 발동하지 않고 세션 쿼터를 소진한다(문서 경고).
    const body = (await (await fetch(`${baseUrl}/ping`)).json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty('time_of_last_update');
  });
});

describe('POST /invocations', () => {
  it('스키마에 맞지 않는 본문은 500 과 사유를 돌려준다', async () => {
    const response = await fetch(`${baseUrl}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '__unknown__' }),
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBe(false);
    // 원인을 알 수 있는 사유가 본문에 담겨야 한다(런타임이 감싸도 로그로 추적 가능해야 한다).
    expect(body.error).toMatch(/스키마 검증/);
  });

  it('JSON 이 아닌 본문도 사유와 함께 500 을 돌려준다', async () => {
    const response = await fetch(`${baseUrl}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/JSON/);
  });
});

describe('그 외 경로', () => {
  it('알 수 없는 경로는 404 를 돌려준다', async () => {
    const response = await fetch(`${baseUrl}/unknown`);

    expect(response.status).toBe(404);
  });
});
