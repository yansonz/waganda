/**
 * lib/api/errors.ts — API 라우트 공통 에러 → NextResponse 매핑.
 *
 * `lib/db/errors.ts` 의 `DbError` 계열(ConflictError/ReferenceIntegrityError/
 * BackreferenceError/NotFoundError)과 `lib/services/tastings.ts` 의
 * `RecordingLimitExceededError` 를 일관된 JSON 형태로 변환한다.
 *
 * `lib/auth/guard.ts` 의 `toErrorResponse` (401/403) 와 조합해 사용한다 —
 * 이 헬퍼는 그 다음 단계인 도메인 에러를 처리한다.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DbError } from '@/lib/db/errors';
import { RecordingLimitExceededError } from '@/lib/services/tastings';

/** 도메인/검증 에러를 표준 JSON 에러 응답으로 변환한다. 처리 불가능한 에러는 null 을 반환한다. */
export function toDomainErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof DbError) {
    const body: Record<string, unknown> = { error: error.code, message: error.message };
    if ('missingRefs' in error) body.missingRefs = error.missingRefs;
    if ('count' in error) body.count = error.count;
    return NextResponse.json(body, { status: error.status });
  }

  if (error instanceof RecordingLimitExceededError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: '요청 형식이 올바르지 않습니다.',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }

  return null;
}

/** 요청 본문을 JSON 으로 안전하게 파싱한다. 실패 시 null. */
export async function parseJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
