// @vitest-environment node
/**
 * lib/http/signedFetch.ts 테스트.
 *
 * CloudFront OAC 는 본문을 서명하지 않고 Lambda Function URL 은 unsigned payload 를
 * 거부한다. 그래서 본문 해시를 `x-amz-content-sha256` 로 실어야 쓰기 요청이 통과한다.
 * 여기서 고정하는 사양:
 * - 해시는 **실제로 전송되는 바이트**와 일치해야 한다 (FormData boundary 포함)
 * - GET·HEAD 에는 붙이지 않는다
 * - 본문이 없는 POST 는 빈 본문 해시를 쓴다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BODY_SHA256, sha256Hex, signedFetch } from '@/lib/http/signedFetch';

interface CapturedRequest {
  headers: Headers;
  body: BodyInit | null | undefined;
  method: string | undefined;
}

let captured: CapturedRequest | undefined;

beforeEach(() => {
  captured = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        headers: new Headers(init?.headers),
        body: init?.body,
        method: init?.method,
      };
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signedFetch', () => {
  it('GET 에는 본문 해시 헤더를 붙이지 않는다', async () => {
    await signedFetch('/api/wines');

    expect(captured?.headers.has('x-amz-content-sha256')).toBe(false);
  });

  it('본문 없는 POST 에는 빈 본문 해시를 붙인다', async () => {
    await signedFetch('/api/tastings/t1/analyze', { method: 'POST' });

    expect(captured?.headers.get('x-amz-content-sha256')).toBe(EMPTY_BODY_SHA256);
  });

  it('JSON 본문의 해시가 전송 바이트의 SHA-256 과 일치하고 본문은 원본 그대로 전달된다', async () => {
    const payload = JSON.stringify({ wineId: 'w1', rating: 4.5 });

    await signedFetch('/api/tastings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    const expected = await sha256Hex(new TextEncoder().encode(payload).buffer as ArrayBuffer);
    expect(captured?.headers.get('x-amz-content-sha256')).toBe(expected);
    // 문자열은 재직렬화해도 같은 바이트라 원본을 그대로 넘긴다
    // (호출부·서버가 보는 요청 형태를 바꾸지 않는다).
    expect(captured?.body).toBe(payload);
  });

  it('PATCH 본문도 해시를 계산한다', async () => {
    await signedFetch('/api/tastings/t1/rating', {
      method: 'PATCH',
      body: JSON.stringify({ rating: 3 }),
    });

    expect(captured?.headers.get('x-amz-content-sha256')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('FormData 는 boundary 가 포함된 Content-Type 을 실고 해시가 전송 바이트와 일치한다', async () => {
    const form = new FormData();
    form.append('field', 'value');

    await signedFetch('/api/labels/upload', { method: 'POST', body: form });

    const contentType = captured?.headers.get('content-type');
    // boundary 가 없으면 서버가 multipart 를 파싱할 수 없다
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);

    // FormData 는 직렬화마다 boundary 가 바뀌므로 바이트로 치환해 보내야 한다.
    // 그래야 해시를 계산한 바이트와 전송 바이트가 같다.
    expect(captured?.body).toBeInstanceOf(ArrayBuffer);
    const sentHash = await sha256Hex(captured!.body as ArrayBuffer);
    expect(captured?.headers.get('x-amz-content-sha256')).toBe(sentHash);
  });

  it('파일(Blob) 본문도 해시를 계산하고 호출부 Content-Type 을 유지한다', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/heic' });

    await signedFetch('/api/labels/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'image/heic' },
      body: blob,
    });

    expect(captured?.headers.get('content-type')).toBe('image/heic');
    const expected = await sha256Hex(await blob.arrayBuffer());
    expect(captured?.headers.get('x-amz-content-sha256')).toBe(expected);
  });

  it('호출부가 이미 해시 헤더를 넣었으면 덮어쓰지 않는다', async () => {
    await signedFetch('/api/wines', {
      method: 'POST',
      headers: { 'x-amz-content-sha256': 'preset' },
      body: '{}',
    });

    expect(captured?.headers.get('x-amz-content-sha256')).toBe('preset');
  });
});
