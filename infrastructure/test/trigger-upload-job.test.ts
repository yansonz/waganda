/**
 * trigger-upload 이 만드는 신규 Job 레코드가 공유 Job 스키마(`@waganda/schemas`)가
 * 요구하는 필드 계약을 지키는지 검증한다.
 *
 * 회귀 배경: 예전 trigger-upload 은 type·schemaVersion·rev 없이 Job 을 만들었고,
 * 에이전트(AgentCore)의 getJob 이 Zod 검증에서 터져 500 을 반환 → 전사가 시작되지
 * 않은 채 Job 이 'transcribing' 에서 영구히 멈췄다. 이 테스트가 그 회귀를 막는다.
 *
 * 주의: 인프라 tsconfig(node16 moduleResolution)는 스키마 패키지의 bundler 식 소스를
 * 타입 레벨에서 해석하지 못하므로, 스키마를 import 하지 않고 계약(필수 필드·타입)을
 * 직접 검증한다. 스키마 원본은 packages/schemas/src/job.ts(Job)·common.ts
 * (entityMetaShape: schemaVersion·rev, CURRENT_SCHEMA_VERSION=2)다.
 */
import { describe, expect, it } from 'vitest';
import { buildNewJobRecord } from '../lambda/trigger-upload';

describe('buildNewJobRecord', () => {
  const tastingId = '970de7f1-4659-4013-a26f-8510a7b87539';
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  it('DynamoDB 키(pk/sk)를 규약대로 만든다', () => {
    const record = buildNewJobRecord(tastingId);
    expect(record.pk).toBe(`TASTING#${tastingId}`);
    expect(record.sk).toBe('JOB');
  });

  it('Job 스키마 필수 필드(type·schemaVersion·rev)를 포함한다', () => {
    const record = buildNewJobRecord(tastingId);
    // 이 세 필드가 빠지면 에이전트 getJob 의 Zod 검증이 터진다 (이번 버그의 핵심).
    expect(record.type).toBe('JOB');
    expect(record.schemaVersion).toBe(2); // CURRENT_SCHEMA_VERSION
    expect(record.rev).toBe(0);
  });

  it('나머지 도메인 필드도 스키마 계약을 지킨다', () => {
    const record = buildNewJobRecord(tastingId);
    expect(record.tastingId).toBe(tastingId);
    expect(record.status).toBe('queued'); // JobStatus enum
    expect(record.completedSteps).toEqual([]);
    expect(record.attempts).toBe(0);
    expect(String(record.createdAt)).toMatch(ISO);
    expect(String(record.updatedAt)).toMatch(ISO);
  });
});
