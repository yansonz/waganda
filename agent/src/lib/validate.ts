/**
 * lib/validate.ts — 에이전트 구조화 출력의 Zod 검증 + 재생성 재시도.
 *
 * design.md '출력 스키마 검증' (R6): 소믈리에 등 에이전트 출력을 Zod 로 검증하고,
 * 위반 시 최대 2회 재생성한다. 2회 후에도 실패하면 실패로 취급하고 원본(오디오·
 * 트랜스크립트)은 보존한다 — 이 함수는 재시도 루프만 담당하며 보존 책임은
 * 호출부(그래프 노드)에 있다.
 */
import type { z } from 'zod';

/** 재생성 최대 횟수 — 최초 시도 포함 총 3회 시도(최초 1 + 재생성 2) */
export const MAX_REGENERATION_ATTEMPTS = 2;

export interface ValidateWithRetryOptions<T> {
  /** 결과를 검증할 Zod 스키마 */
  schema: z.ZodType<T>;
  /** 모델 출력을 생성하는 함수. attempt(0-based)를 받아 이전 실패 사유를 프롬프트에 반영할 수 있게 한다 */
  generate: (attempt: number, lastError?: string) => Promise<unknown>;
  /** 재생성 최대 횟수 (기본 2) */
  maxRegenerations?: number;
}

export interface ValidateWithRetryResult<T> {
  ok: boolean;
  data?: T;
  /** 시도 횟수 (최초 시도 포함) */
  attempts: number;
  /** 실패 시 마지막 오류 사유 */
  lastError?: string;
}

/**
 * `generate` 를 호출해 얻은 결과를 스키마로 검증한다. 검증에 실패하면
 * `maxRegenerations` 회까지 재생성을 재시도한다. 모두 실패하면 `ok: false` 를 반환한다
 * (예외를 던지지 않는다 — 호출부가 작업을 `failed` 로 전환하고 원본을 보존하도록 한다).
 */
export async function validateWithRetry<T>(
  options: ValidateWithRetryOptions<T>,
): Promise<ValidateWithRetryResult<T>> {
  const maxRegenerations = options.maxRegenerations ?? MAX_REGENERATION_ATTEMPTS;
  const totalAttempts = maxRegenerations + 1;

  let lastError: string | undefined;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const raw = await options.generate(attempt, lastError);
    const parsed = options.schema.safeParse(raw);

    if (parsed.success) {
      return { ok: true, data: parsed.data, attempts: attempt + 1 };
    }

    lastError = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
  }

  return { ok: false, attempts: totalAttempts, lastError };
}
