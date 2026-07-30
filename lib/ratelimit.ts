/**
 * lib/ratelimit.ts — DynamoDB 조건부 증가 + TTL 카운터 기반 IP 속도 제한 (15.4).
 *
 * design.md 'CSRF 와 남용 방지': WAF 대신 애플리케이션 계층에서 구현한다.
 * 키 구조: pk=`RATE#<ipHash>`, sk=`<윈도우>` (lib/db/keys.ts 의 ratePk/rateSk 참고).
 *
 * IP 는 원문을 저장하지 않고 해싱해 사용한다 (개인정보 최소화).
 */
import { createHash } from 'node:crypto';
import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '@/lib/db/client';
import { getRuntimeConfig } from '@/lib/config';
import { ratePk, rateSk } from '@/lib/db/keys';

/**
 * 고정 윈도우 길이(초) — 기본 60초.
 * `WAGANDA_RATE_LIMIT_WINDOW_SEC` 로 조정할 수 있다.
 */
export const RATE_LIMIT_WINDOW_SEC = Number(process.env.WAGANDA_RATE_LIMIT_WINDOW_SEC ?? 60);

/**
 * 윈도우당 허용 요청 수 — 기본 60건.
 *
 * `WAGANDA_RATE_LIMIT_MAX` 로 조정한다. E2E 는 같은 IP 에서 수백 건을 연속 호출하므로
 * 상한을 올려 두지 않으면 정상 시나리오가 429 로 막힌다(테스트를 위한 예외가 아니라
 * 환경별 임계값 설정이다 — 운영 기본값은 그대로 60건이다).
 */
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.WAGANDA_RATE_LIMIT_MAX ?? 60);
/** TTL 여유분(초) — 윈도우가 끝난 뒤 레코드가 자연 정리되도록 여유를 둔다 */
const TTL_GRACE_SEC = 120;

/** IP 를 SHA-256 으로 해싱한다. 원문 IP 는 저장하지 않는다 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

/** 현재 시각을 고정 윈도우 식별자로 변환한다 (예: 1970-01-01T00:00 단위의 초 버킷) */
export function currentWindow(nowMs: number, windowSec: number = RATE_LIMIT_WINDOW_SEC): string {
  const bucket = Math.floor(nowMs / 1000 / windowSec);
  return `w${bucket}`;
}

export interface RateLimitResult {
  /** 허용 여부 */
  allowed: boolean;
  /** 이번 윈도우에서 지금까지 소비된 요청 수 (이번 요청 포함) */
  count: number;
  limit: number;
  windowSec: number;
}

/**
 * IP 해시 기준 속도 제한을 검사하고 카운터를 증가시킨다.
 * DynamoDB `UpdateCommand` 의 `ADD` + `ConditionExpression` 으로 원자적 증가 후
 * 상한 초과 시 애플리케이션 레벨에서 차단 여부를 판정한다.
 *
 * (DynamoDB 조건부 증가만으로 "상한 초과 시 증가 자체를 막는" 것도 가능하지만,
 *  요청이 상한을 얼마나 넘었는지 알려주기 위해 우선 증가시키고 나서 판정한다.)
 */
export async function checkRateLimit(
  ipHash: string,
  options: {
    client?: DynamoDBDocumentClient;
    tableName?: string;
    now?: Date;
    windowSec?: number;
    maxRequests?: number;
  } = {},
): Promise<RateLimitResult> {
  const client = options.client ?? getDocClient();
  const tableName = options.tableName ?? getRuntimeConfig().tableName;
  const windowSec = options.windowSec ?? RATE_LIMIT_WINDOW_SEC;
  const maxRequests = options.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
  const nowMs = (options.now ?? new Date()).getTime();

  const window = currentWindow(nowMs, windowSec);
  const pk = ratePk(ipHash);
  const sk = rateSk(window);
  const ttl = Math.floor(nowMs / 1000) + windowSec + TTL_GRACE_SEC;

  const result = await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk, sk },
      UpdateExpression: 'ADD #count :inc SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':inc': 1, ':ttl': ttl },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

  const count = Number(result.Attributes?.['count'] ?? 0);

  return {
    allowed: count <= maxRequests,
    count,
    limit: maxRequests,
    windowSec,
  };
}

/** 요청에서 클라이언트 IP 를 추출한다 (Next.js 는 표준 헤더를 신뢰한다) */
export function extractClientIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
