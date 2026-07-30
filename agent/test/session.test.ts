import { describe, expect, it } from 'vitest';
import { assertValidRuntimeSessionId, buildRuntimeSessionId } from '../src/lib/session.js';
import { MIN_RUNTIME_SESSION_ID_LENGTH } from '@waganda/schemas';

describe('lib/session — AgentCore 세션 ID 규칙 (최소 33자)', () => {
  it('충분히 긴 tastingId 로 만든 세션 ID는 33자 이상이다', () => {
    const sessionId = buildRuntimeSessionId('tasting-abcdefgh', 'dev');
    expect(sessionId.length).toBeGreaterThanOrEqual(MIN_RUNTIME_SESSION_ID_LENGTH);
  });

  it('세션 A/B 가 동일 tastingId·env 로 만들면 동일한 세션 ID를 얻는다', () => {
    const a = buildRuntimeSessionId('tasting-abcdefghi', 'prod');
    const b = buildRuntimeSessionId('tasting-abcdefghi', 'prod');
    expect(a).toBe(b);
  });

  it('33자 미만 세션 ID는 명시적으로 실패한다', () => {
    expect(() => assertValidRuntimeSessionId('short-id')).toThrow(/33/);
  });

  it('33자 이상 세션 ID는 통과한다', () => {
    const id = 'x'.repeat(MIN_RUNTIME_SESSION_ID_LENGTH);
    expect(() => assertValidRuntimeSessionId(id)).not.toThrow();
  });

  it('tastingId 가 짧아도 결정론적으로 패딩되어 33자를 만족하고, 동일 입력에 항상 동일 결과를 낸다', () => {
    const a = buildRuntimeSessionId('t1', 'dev');
    const b = buildRuntimeSessionId('t1', 'dev');
    expect(a.length).toBeGreaterThanOrEqual(MIN_RUNTIME_SESSION_ID_LENGTH);
    expect(a).toBe(b);
  });
});
