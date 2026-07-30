/**
 * 데이터 계층 전용 에러 정의.
 *
 * 각 에러는 `code`(문자열 식별자)와 `status`(HTTP 상태 매핑용)를 가지며,
 * 사용자에게 노출 가능한 한국어 `message`를 보유한다.
 * API 라우트는 이 에러를 잡아 `status`/`code`/`message`를 그대로 응답에 매핑한다.
 */

/** 데이터 계층 에러의 공통 베이스 */
export abstract class DbError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
}

/**
 * 낙관적 동시성 충돌 — `rev` 대조 `ConditionExpression` 실패 시 발생.
 * 클라이언트가 최신 값을 다시 읽고 재시도해야 한다 (409 매핑).
 */
export class ConflictError extends DbError {
  readonly code = 'CONFLICT';
  readonly status = 409;

  constructor(
    message = '다른 곳에서 먼저 수정되었습니다. 최신 값을 다시 불러온 뒤 재시도하세요.',
    public readonly details?: { pk: string; sk: string; expectedRev?: number },
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * 참조 무결성 위반 — `wine.wineryId`/`wine.regionId`/`tasting.wineId`/`region.parentId`가
 * 가리키는 대상이 존재하지 않을 때 쓰기를 거부한다.
 */
export class ReferenceIntegrityError extends DbError {
  readonly code = 'REFERENCE_INTEGRITY';
  readonly status = 400;

  constructor(
    message: string,
    public readonly missingRefs: { field: string; refId: string }[],
  ) {
    super(message);
    this.name = 'ReferenceIntegrityError';
  }
}

/**
 * 역참조 위반 — 삭제 대상을 다른 레코드가 참조하고 있을 때 삭제를 거부한다.
 * (예: 시음 기록이 있는 와인 삭제 시도)
 */
export class BackreferenceError extends DbError {
  readonly code = 'BACKREFERENCE_EXISTS';
  readonly status = 409;

  constructor(
    message: string,
    public readonly count: number,
  ) {
    super(message);
    this.name = 'BackreferenceError';
  }
}

/** 대상 레코드를 찾을 수 없음 */
export class NotFoundError extends DbError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor(message = '요청한 데이터를 찾을 수 없습니다.') {
    super(message);
    this.name = 'NotFoundError';
  }
}
