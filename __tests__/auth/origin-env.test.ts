/**
 * Origin 검증의 환경별 동작 회귀 테스트.
 *
 * 배경: dev 서버 포트(3000)와 `APP_BASE_URL` 이 어긋나면 정상 요청이 403 이 되어
 * 로컬 확인이 막힌다. 그래서 **local/test 환경에서만** 루프백 출처를 허용한다.
 * 이 완화가 dev/prod 로 새지 않는다는 것을 여기서 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { assertSameOrigin, ForbiddenError } from '@/lib/auth/guard';

function makeRequest(origin: string | null, method = 'POST'): NextRequest {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  return { method, headers } as unknown as NextRequest;
}

const ORIGINAL_ENV = process.env.WAGANDA_ENV;
const ORIGINAL_BASE = process.env.APP_BASE_URL;

beforeEach(() => {
  process.env.APP_BASE_URL = 'https://waganda.yanbert.com';
});

afterEach(() => {
  process.env.WAGANDA_ENV = ORIGINAL_ENV;
  process.env.APP_BASE_URL = ORIGINAL_BASE;
});

describe('assertSameOrigin — 환경별 루프백 허용', () => {
  it('APP_BASE_URL 과 같은 Origin 은 어느 환경에서든 허용한다', () => {
    process.env.WAGANDA_ENV = 'prod';
    expect(() => assertSameOrigin(makeRequest('https://waganda.yanbert.com'))).not.toThrow();
  });

  it('local 환경에서는 localhost·127.0.0.1 Origin 을 허용한다', () => {
    process.env.WAGANDA_ENV = 'local';
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3100',
    ]) {
      expect(() => assertSameOrigin(makeRequest(origin)), origin).not.toThrow();
    }
  });

  it('prod 환경에서는 localhost Origin 을 거부한다 (완화가 새지 않는다)', () => {
    process.env.WAGANDA_ENV = 'prod';
    expect(() => assertSameOrigin(makeRequest('http://localhost:3000'))).toThrow(ForbiddenError);
    expect(() => assertSameOrigin(makeRequest('http://127.0.0.1:3000'))).toThrow(ForbiddenError);
  });

  it('dev 환경에서도 localhost Origin 을 거부한다', () => {
    process.env.WAGANDA_ENV = 'dev';
    expect(() => assertSameOrigin(makeRequest('http://localhost:3000'))).toThrow(ForbiddenError);
  });

  it('local 환경이라도 외부 도메인 Origin 은 거부한다', () => {
    process.env.WAGANDA_ENV = 'local';
    for (const origin of [
      'https://evil.example.com',
      'http://localhost.evil.example.com',
      'http://127.0.0.1.evil.example.com',
    ]) {
      expect(() => assertSameOrigin(makeRequest(origin)), origin).toThrow(ForbiddenError);
    }
  });

  it('Origin 헤더가 없으면 환경과 무관하게 거부한다', () => {
    for (const env of ['local', 'dev', 'prod']) {
      process.env.WAGANDA_ENV = env;
      expect(() => assertSameOrigin(makeRequest(null)), env).toThrow(ForbiddenError);
    }
  });

  it('GET·HEAD 는 Origin 검증 대상이 아니다', () => {
    process.env.WAGANDA_ENV = 'prod';
    expect(() => assertSameOrigin(makeRequest(null, 'GET'))).not.toThrow();
    expect(() => assertSameOrigin(makeRequest(null, 'HEAD'))).not.toThrow();
  });
});
