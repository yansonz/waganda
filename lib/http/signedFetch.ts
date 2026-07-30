/**
 * lib/http/signedFetch.ts — 쓰기 요청에 본문 해시 헤더를 붙이는 fetch 래퍼.
 *
 * ## 왜 필요한가
 *
 * 이 서비스는 CloudFront → Lambda Function URL(OAC, AWS_IAM) 구조다.
 * OAC 는 오리진 요청에 SigV4 서명을 붙여 주지만 **요청 본문은 서명에 포함하지 않는다.**
 * Lambda Function URL 은 unsigned payload 를 허용하지 않으므로, 본문이 있는 요청
 * (POST·PUT·PATCH)은 서명 불일치로 거부된다 — 실제로 프로덕션에서 모든 쓰기가
 * `The request signature we calculated does not match the signature you provided` 로 실패했다.
 *
 * AWS 문서가 지정한 해법은 **클라이언트가 본문의 SHA-256 을 계산해
 * `x-amz-content-sha256` 헤더로 보내는 것**이다.
 * (Restrict access to an AWS Lambda function URL origin — "your users must compute the
 *  SHA256 of the body and include the payload hash value ... Lambda doesn't support
 *  unsigned payloads.")
 *
 * ## 주의
 *
 * - 이 래퍼는 **우리 API(`/api/*`)로 보내는 요청에만** 쓴다. S3 사전 서명 URL 로
 *   직접 올리는 PUT 은 CloudFront 를 거치지 않으므로 헤더를 붙이면 오히려 서명이 깨진다.
 * - 본문을 바이트로 한 번 직렬화해 해시와 전송에 같은 값을 쓴다. `FormData` 는 브라우저가
 *   boundary 를 생성하므로, 직렬화하면서 얻은 `Content-Type` 을 함께 실어야 한다.
 * - 로컬 개발(next dev)에는 CloudFront 가 없어 헤더가 무시된다. 동작에 영향이 없다.
 */

/** 빈 본문의 SHA-256 (RFC 6234 테스트 벡터) */
export const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** 본문 없이 보내는 메서드 — 해시 헤더가 필요하지 않다 */
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 본문 바이트의 SHA-256 을 16진수 문자열로 돌려준다 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/**
 * 요청 본문을 바이트로 직렬화한다.
 *
 * `Response` 를 경유하면 string·Blob·File·FormData·ArrayBuffer·URLSearchParams 를
 * 모두 같은 방식으로 다룰 수 있고, FormData 의 boundary 가 포함된 `Content-Type` 도 얻는다.
 */
async function serializeBody(
  body: BodyInit,
): Promise<{ bytes: ArrayBuffer; contentType: string | null }> {
  const staged = new Response(body);
  const bytes = await staged.arrayBuffer();
  return { bytes, contentType: staged.headers.get('content-type') };
}

/**
 * 본문을 다시 직렬화해도 같은 바이트가 나오는지 여부.
 *
 * `FormData` 는 직렬화할 때마다 새 boundary 가 생성되므로, 해시를 계산한 바이트와
 * 실제 전송 바이트가 달라진다. `ReadableStream` 은 한 번만 읽을 수 있다.
 * 이 두 경우만 바이트로 치환해 보내고, 나머지는 원본을 그대로 넘긴다
 * (원본을 유지하면 호출부·테스트가 보는 요청 형태가 바뀌지 않는다).
 */
function needsBodyReplacement(body: BodyInit): boolean {
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return true;
  return false;
}

/**
 * 쓰기 요청에 `x-amz-content-sha256` 을 붙여 보낸다.
 *
 * GET·HEAD 는 그대로 통과시킨다. 이미 헤더가 있으면 덮어쓰지 않는다.
 */
export async function signedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (BODYLESS_METHODS.has(method)) {
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  if (headers.has('x-amz-content-sha256')) {
    return fetch(input, init);
  }

  // 본문이 없는 POST·DELETE 도 있다(예: 분석 재실행 트리거). 이때는 빈 본문 해시를 쓴다.
  if (init?.body === undefined || init.body === null) {
    headers.set('x-amz-content-sha256', EMPTY_BODY_SHA256);
    return fetch(input, { ...init, headers });
  }

  const { bytes, contentType } = await serializeBody(init.body);
  headers.set('x-amz-content-sha256', await sha256Hex(bytes));
  // 호출부가 Content-Type 을 지정하지 않았다면 직렬화 결과를 따른다
  // (FormData 는 boundary 가 포함돼야 서버가 파싱할 수 있다).
  if (contentType !== null && !headers.has('content-type')) {
    headers.set('content-type', contentType);
  }

  if (needsBodyReplacement(init.body)) {
    // 해시를 계산한 것과 **같은 바이트**를 보낸다.
    return fetch(input, { ...init, headers, body: bytes });
  }

  return fetch(input, { ...init, headers });
}
