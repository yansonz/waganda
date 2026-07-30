import { NextResponse, type NextRequest } from 'next/server';
import { getRuntimeConfig } from '@/lib/config';
import {
  getEditorSession,
  requireEditor,
  UnauthorizedError,
  type EditorSession,
} from '@/lib/auth/session';

/**
 * 쓰기 라우트 공통 가드.
 *
 * 설계 근거: .kiro/specs/mvp/design.md 'API 계약' 의 401 응답 형식.
 * 미인증 쓰기 요청은 반드시 다음 형태로 응답한다:
 *   { "error": "UNAUTHORIZED", "loginUrl": "/api/auth/google/start?returnTo=..." }
 */

/** Origin 검증 실패를 나타내는 에러. 가드 계층에서 403 으로 변환한다. */
export class ForbiddenError extends Error {
  constructor(message = '허용되지 않은 요청 출처입니다.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** 401 응답 본문 형식 (design.md API 계약과 동일) */
interface UnauthorizedBody {
  error: 'UNAUTHORIZED';
  loginUrl: string;
}

/** 현재 요청 경로를 returnTo 로 사용해 로그인 URL 을 만든다. */
function buildLoginUrl(request: NextRequest): string {
  const path = request.nextUrl.pathname + request.nextUrl.search;
  return `/api/auth/google/start?returnTo=${encodeURIComponent(path)}`;
}

/**
 * 편집자 세션을 요구한다. 없으면 401 + loginUrl 을 담은 NextResponse 를 반환하고,
 * 있으면 세션 객체를 반환한다.
 *
 * 사용 예:
 * ```ts
 * const result = await requireEditorOr401(request);
 * if (result instanceof NextResponse) return result;
 * const session = result; // EditorSession
 * ```
 */
export async function requireEditorOr401(
  request: NextRequest,
): Promise<EditorSession | NextResponse<UnauthorizedBody>> {
  const session = await getEditorSession();
  if (session) return session;

  const body: UnauthorizedBody = {
    error: 'UNAUTHORIZED',
    loginUrl: buildLoginUrl(request),
  };
  return NextResponse.json(body, { status: 401 });
}

/**
 * Origin 헤더가 APP_BASE_URL 과 동일한 출처인지 검증한다.
 * GET 요청은 검증 대상이 아니다(부작용 없는 조회이므로).
 * Origin 헤더가 없는 요청도 거부한다(브라우저가 아닌 임의 클라이언트의 위조 요청 가능성).
 *
 * @throws {ForbiddenError} Origin 이 없거나 일치하지 않을 때
 */
export function assertSameOrigin(request: NextRequest): void {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return;
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    throw new ForbiddenError('Origin 헤더가 없는 요청은 허용되지 않습니다.');
  }

  const config = getRuntimeConfig();
  const expected = new URL(config.appBaseUrl).origin;

  if (origin === expected) {
    return;
  }

  // 로컬 개발 편의: 같은 머신의 루프백 출처는 허용한다.
  // dev 서버 포트(3000)와 APP_BASE_URL 이 어긋나거나 localhost/127.0.0.1 을
  // 섞어 쓰면 정상 요청이 403 이 되기 때문이다.
  // **local/test 환경에서만** 적용하며 dev/prod 배포에는 영향이 없다.
  if (config.env === 'local' || config.env === 'test') {
    const { hostname, protocol } = new URL(origin);
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (isLoopback && (protocol === 'http:' || protocol === 'https:')) {
      return;
    }
  }

  throw new ForbiddenError(`허용되지 않은 Origin 입니다: ${origin}`);
}

/** UnauthorizedError/ForbiddenError 를 적절한 NextResponse 로 변환한다. */
export function toErrorResponse(error: unknown, request: NextRequest): NextResponse | null {
  if (error instanceof UnauthorizedError) {
    const body: UnauthorizedBody = {
      error: 'UNAUTHORIZED',
      loginUrl: buildLoginUrl(request),
    };
    return NextResponse.json(body, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'FORBIDDEN', message: error.message }, { status: 403 });
  }
  return null;
}

type RouteHandler = (
  request: NextRequest,
  context: { session: EditorSession },
) => Promise<NextResponse> | NextResponse;

/**
 * 쓰기 라우트를 한 줄로 감싸는 래퍼.
 * - Origin 동일 출처 검증 (GET 제외)
 * - 편집자 세션 요구
 * 둘 중 하나라도 실패하면 401/403 응답을 반환하고, 성공하면 핸들러에 세션을 전달한다.
 *
 * 사용 예:
 * ```ts
 * export const POST = withEditorGuard(async (request, { session }) => {
 *   // session.email 사용 가능
 *   return NextResponse.json({ ok: true });
 * });
 * ```
 */
export function withEditorGuard(handler: RouteHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      assertSameOrigin(request);
      const session = await requireEditor();
      return await handler(request, { session });
    } catch (error) {
      const response = toErrorResponse(error, request);
      if (response) return response;
      throw error;
    }
  };
}
