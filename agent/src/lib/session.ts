/**
 * lib/session.ts — AgentCore Runtime 세션 ID 규칙 + Strands SessionManager 연결.
 *
 * **SDK 실사 확인**: `@strands-agents/sdk` 1.11.2 에는 design.md 가 전제한
 * `S3SessionManager` 클래스가 없다. 실제로 존재하는 조합은
 *   `new SessionManager({ storage: new S3Storage(bucket, { prefix }) })`
 * 이다 (`SessionManager` 는 패키지 루트, `S3Storage` 는 `@strands-agents/sdk/storage`
 * 서브패스). `@strands-agents/sdk/session/s3-storage` 의 `S3Storage` 는 구버전
 * `SnapshotStorage` 어댑터로 `@deprecated` 표시되어 있어 사용하지 않는다.
 *
 * design.md '재개 전략'의 원칙대로, 이 SessionManager 가 제공하는 대화 세션
 * 지속성은 편의 기능일 뿐이다. 파이프라인 정합성은 DynamoDB 의 `Job.completedSteps`
 * 가 보장하므로, 세션 복원이 기대와 다르게 동작해도 그래프 실행 결과는 올바르다.
 */
import { SessionManager } from '@strands-agents/sdk';
import { S3Storage } from '@strands-agents/sdk/storage';
import { MIN_RUNTIME_SESSION_ID_LENGTH } from '@waganda/schemas';

/**
 * `tastingId` 와 환경으로부터 결정론적 세션 ID를 만든다.
 * 세션 A/B 두 호출이 **동일한 세션 ID**를 만들어야 하므로 tastingId 만으로 결정한다.
 *
 * `tastingId` 가 짧으면(`EntityId` 스키마는 최소 1자만 요구한다) 고정 접두사만으로
 * 33자에 못 미칠 수 있다. 이 경우 tastingId 를 반복해 결정론적으로 패딩한다 —
 * 무작위 문자를 덧붙이면 세션 A/B 재호출 시 동일 ID를 재생성할 수 없으므로
 * tastingId 자체를 소스로 쓰는 결정론적 패딩만 허용한다.
 */
export function buildRuntimeSessionId(tastingId: string, env: string): string {
  const base = `waganda-tasting-${tastingId}-${env}`;
  const sessionId = padDeterministically(base, tastingId);
  assertValidRuntimeSessionId(sessionId);
  return sessionId;
}

/** `base` 가 최소 길이에 못 미치면 `source` 를 결정론적으로 반복해 채운다 */
function padDeterministically(base: string, source: string): string {
  if (base.length >= MIN_RUNTIME_SESSION_ID_LENGTH || source.length === 0) {
    return base;
  }
  let padded = base;
  while (padded.length < MIN_RUNTIME_SESSION_ID_LENGTH) {
    padded += `-${source}`;
  }
  return padded;
}

/** AgentCore 세션 ID 최소 길이(33자) 검증. 위반 시 명시적으로 실패시킨다 */
export function assertValidRuntimeSessionId(sessionId: string): void {
  if (sessionId.length < MIN_RUNTIME_SESSION_ID_LENGTH) {
    throw new Error(
      `세션 ID 가 최소 길이(${MIN_RUNTIME_SESSION_ID_LENGTH}자) 미달입니다: "${sessionId}" (${sessionId.length}자)`,
    );
  }
}

/** 에이전트 세션 S3 버킷 기반 SessionManager 생성 옵션 */
export interface CreateSessionManagerOptions {
  /** 에이전트 세션 저장용 S3 버킷명 */
  bucket: string;
  /** 세션 ID (buildRuntimeSessionId 로 생성된 값) */
  sessionId: string;
  /** 버킷 내 키 프리픽스 — 기본값 'agent-sessions' */
  prefix?: string;
}

/**
 * Strands `SessionManager` 를 S3 저장소와 함께 생성한다.
 * 이 세션은 대화 맥락(Agent 의 messages/appState) 유지 용도로만 쓰이며,
 * 파이프라인 재개는 이 세션과 무관하게 DynamoDB `Job.completedSteps` 로 결정된다.
 */
export function createSessionManager(options: CreateSessionManagerOptions): SessionManager {
  assertValidRuntimeSessionId(options.sessionId);
  const storage = new S3Storage(options.bucket, { prefix: options.prefix ?? 'agent-sessions' });
  return new SessionManager({ storage, sessionId: options.sessionId });
}
