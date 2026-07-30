import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, toPriceBand } from '@waganda/schemas';

/**
 * `schemaVersion` 이 낮은 레코드를 `CURRENT_SCHEMA_VERSION` 형태로 승격한다.
 *
 * - v1 → v2 승격 규칙 (예시):
 *   - `rev` 필드가 없으면 0 으로 채운다 (신규 도입 필드).
 *   - `priceBand` 가 없고 `priceKrw` 가 있으면 `toPriceBand(priceKrw)` 로 파생시킨다.
 *   - `grapes` 가 문자열 단일값이면 배열로 감싼다 (v1 은 단일 문자열 허용).
 * - Zod 파싱 실패 레코드는 `console.warn` 으로 로그한 뒤 격리(quarantine)하며,
 *   `upcastMany()` 를 호출한 전체 조회 자체는 실패시키지 않는다.
 */

/** 레코드 최소 형태 — schemaVersion 필드만 보장한다 */
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSchemaVersion(raw: UnknownRecord): number {
  const v = raw['schemaVersion'];
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/**
 * v1 레코드를 v2 형태로 승격한다.
 * v1 특징: `rev` 없음, `priceBand` 없음, `grapes` 가 문자열 단일값일 수 있음.
 */
function upcastV1ToV2(raw: UnknownRecord): UnknownRecord {
  const upcasted: UnknownRecord = { ...raw };

  // rev 필드 없음 → 0 으로 채운다 (v2 신규 필드)
  if (typeof upcasted['rev'] !== 'number') {
    upcasted['rev'] = 0;
  }

  // grapes 가 문자열 단일값이면 배열화
  const grapes = upcasted['grapes'];
  if (typeof grapes === 'string') {
    upcasted['grapes'] = grapes.trim().length > 0 ? [grapes.trim()] : [];
  }

  // priceBand 가 없고 priceKrw 가 있으면 파생
  if (upcasted['priceBand'] === undefined) {
    const priceKrw = upcasted['priceKrw'];
    if (typeof priceKrw === 'number') {
      const derived = toPriceBand(priceKrw);
      if (derived !== undefined) {
        upcasted['priceBand'] = derived;
      }
    }
  }

  upcasted['schemaVersion'] = 2;
  return upcasted;
}

/** 버전별 승격 규칙 테이블. 다음 버전이 추가되면 여기에 단계를 추가한다 */
const UPCAST_STEPS: Record<number, (raw: UnknownRecord) => UnknownRecord> = {
  1: upcastV1ToV2,
};

/**
 * 레코드의 `schemaVersion` 이 `CURRENT_SCHEMA_VERSION` 보다 낮으면
 * 순차적으로 승격 단계를 적용해 최신 형태로 만든다.
 * 이미 최신이거나 스키마 형태를 판별할 수 없는 입력은 그대로 반환한다.
 */
export function upcastRecord(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;

  let current: UnknownRecord = raw;
  let version = readSchemaVersion(current);

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = UPCAST_STEPS[version];
    if (!step) {
      // 승격 규칙이 정의되지 않은 버전 — 더 진행할 수 없으므로 현재 상태로 중단한다.
      // 이후 Zod 파싱에서 실패하면 upcastMany 가 격리 처리한다.
      break;
    }
    current = step(current);
    version = readSchemaVersion(current);
  }

  return current;
}

/** 격리된 레코드 — 원본과 실패 사유를 함께 보관한다 */
export interface QuarantinedRecord {
  raw: unknown;
  reason: string;
}

export interface UpcastManyResult<T> {
  ok: T[];
  quarantined: QuarantinedRecord[];
}

/**
 * 레코드 배열을 승격 후 Zod 스키마로 파싱한다.
 * 파싱 실패 레코드는 `console.warn` 로그와 함께 격리하고, 전체 처리는 계속한다.
 */
export function upcastMany<S extends z.ZodType>(
  rawRecords: unknown[],
  schema: S,
): UpcastManyResult<z.infer<S>> {
  const ok: z.infer<S>[] = [];
  const quarantined: QuarantinedRecord[] = [];

  for (const raw of rawRecords) {
    const upcasted = upcastRecord(raw);
    const parsed = schema.safeParse(upcasted);

    if (parsed.success) {
      ok.push(parsed.data);
    } else {
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      console.warn('[lib/db/upcast] 레코드 파싱 실패 — 격리 처리:', reason, upcasted);
      quarantined.push({ raw, reason });
    }
  }

  return { ok, quarantined };
}
