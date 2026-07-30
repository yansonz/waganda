import { cookies } from 'next/headers';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { getAuthConfig } from '@/lib/config';

/**
 * 편집자 세션 발급·검증 모듈.
 *
 * 설계 근거: .kiro/specs/mvp/design.md '인증 설계' 섹션.
 * - JWT 는 jose HS256 으로 서명한다.
 * - 서명·만료 검증에 더해 **매 요청마다 허용 목록을 재검증**한다.
 *   서명이 유효해도 허용 목록에서 빠진 이메일은 즉시 무효로 처리한다.
 *   서버 측 세션 저장소 없이 권한을 즉시 회수하는 유일한 수단이다.
 */

/** 편집자 세션 쿠키 이름 */
export const COOKIE_NAME = 'waganda_editor_session';

/** OAuth CSRF 방어용 state 쿠키 이름 */
export const OAUTH_STATE_COOKIE_NAME = 'waganda_oauth_state';

/** OAuth 완료 후 되돌아갈 경로를 담는 쿠키 이름 */
export const OAUTH_RETURN_TO_COOKIE_NAME = 'waganda_oauth_return_to';

/** state/returnTo 쿠키는 로그인 흐름 동안만 살아있으면 된다 (10분) */
const OAUTH_STATE_TTL_SEC = 60 * 10;

/** 편집자 세션 페이로드 (design.md 의 EditorSession 타입) */
export interface EditorSession {
  email: string;
  iat: number;
  exp: number;
}

/** 이메일을 허용 목록과 대소문자 무시·trim 하여 비교 */
export function isAllowedEmail(email: string, allowlist: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  return allowlist.includes(normalized);
}

/** 편집자 JWT 서명. 이메일은 소문자로 정규화해 저장한다. */
export async function signEditorJWT(email: string): Promise<string> {
  const config = await getAuthConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  const normalizedEmail = email.trim().toLowerCase();

  return await new SignJWT({ email: normalizedEmail })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.sessionTtlSec}s`)
    .sign(secret);
}

/**
 * 편집자 JWT 검증.
 *
 * 검증 순서:
 * 1. 서명 검증 (jose 가 처리)
 * 2. 만료 검증 (jose 가 처리, exp 클레임)
 * 3. 허용 목록 재검증 — 서명은 유효하지만 허용 목록에서 빠진 이메일은 무효로 처리한다
 *
 * 유효하지 않으면 null 을 반환한다 (throw 하지 않음 — 호출부가 미인증으로 처리).
 */
/** 로그에 이메일 전체를 남기지 않는다 (개인정보 최소화) */
function maskEmailForLog(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}**@${domain}`;
}

export async function verifyEditorJWT(token: string): Promise<EditorSession | null> {
  const config = await getAuthConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);

  let payload;
  try {
    const result = await jwtVerify(token, secret);
    payload = result.payload;
  } catch (error) {
    // 서명 오류, 만료(JWTExpired) 등은 모두 미인증으로 처리한다.
    // 사유를 남겨 "쓰기 버튼마다 재인증" 같은 증상의 원인을 서버 로그에서 구분할 수 있게 한다.
    if (error instanceof joseErrors.JWTExpired) {
      console.warn('[auth] 세션 토큰이 만료되었습니다 — 재로그인이 필요합니다.');
      return null;
    }
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      console.warn(
        '[auth] 세션 토큰 서명 검증 실패 — EDITOR_JWT_SECRET 이 발급 당시와 다를 수 있습니다.',
      );
      return null;
    }
    if (error instanceof joseErrors.JWTInvalid) {
      console.warn('[auth] 세션 토큰 형식이 올바르지 않습니다.');
      return null;
    }
    console.warn('[auth] 세션 토큰 검증 중 예상치 못한 오류', error);
    return null;
  }

  const email = payload.email;
  if (typeof email !== 'string' || email.trim() === '') {
    console.warn('[auth] 세션 토큰에 이메일 클레임이 없습니다.');
    return null;
  }

  // 허용 목록 매 요청 재검증 — 서명·만료가 유효해도 목록에서 빠졌으면 무효
  if (!isAllowedEmail(email, config.allowlist)) {
    console.warn(
      `[auth] 세션 이메일이 허용 목록에 없습니다 — EDITOR_ALLOWLIST 를 확인하세요. (${maskEmailForLog(email)})`,
    );
    return null;
  }

  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    return null;
  }

  return { email, iat: payload.iat, exp: payload.exp };
}

/**
 * 현재 요청의 편집자 세션을 조회한다.
 * Next.js 15 의 `cookies()` 는 async 이므로 이 함수도 async 다.
 */
export async function getEditorSession(): Promise<EditorSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return await verifyEditorJWT(token);
}

/** 인증되지 않은 요청임을 나타내는 에러. 가드 계층에서 401 로 변환한다. */
export class UnauthorizedError extends Error {
  constructor(message = '편집자 인증이 필요합니다.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** 편집자 세션이 없으면 UnauthorizedError 를 throw 한다. */
export async function requireEditor(): Promise<EditorSession> {
  const session = await getEditorSession();
  if (!session) {
    throw new UnauthorizedError();
  }
  return session;
}

/**
 * 쿠키의 `Secure` 속성 여부.
 *
 * 배포 환경(https)에서는 항상 true 다. 로컬은 `APP_BASE_URL` 이 http 이면 false 로 둔다 —
 * `Secure` 쿠키는 브라우저가 https 응답에서만 저장하는 것이 원칙이고(Safari 는 localhost 도
 * 예외로 두지 않는다), 그러면 로그인해도 세션이 남지 않아 매번 재인증하게 된다.
 */
function shouldUseSecureCookie(): boolean {
  const baseUrl = process.env.APP_BASE_URL ?? '';
  if (baseUrl.startsWith('https://')) return true;
  if (baseUrl.startsWith('http://')) return false;
  // 판단 근거가 없으면 안전한 쪽(Secure 부여)을 택한다.
  return true;
}

/** 편집자 세션 쿠키 옵션 (HttpOnly, SameSite=Lax, path=/, maxAge=세션 TTL) */
export async function editorCookieOptions(): Promise<{
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
}> {
  const config = await getAuthConfig();
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlSec,
  };
}

/** OAuth state/returnTo 쿠키 공통 옵션 (짧은 TTL, 로그인 흐름 동안만 유지) */
export function oauthFlowCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_TTL_SEC,
  };
}
