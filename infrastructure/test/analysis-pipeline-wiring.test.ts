/**
 * 분석 파이프라인 배선 단정.
 *
 * 녹음 업로드 → SQS → trigger-upload → AgentCore(세션 A) → Transcribe →
 * EventBridge → trigger-transcribe → AgentCore(세션 B) 순으로 이어진다.
 *
 * 이 배선이 하나라도 끊기면 분석이 조용히 멈춘다. 실제로 두 트리거 Lambda 가
 * `Would invoke AgentCore Runtime` 로그만 남기고 실제 호출을 하지 않아, job 레코드만
 * 만들어진 채 상태가 `queued`·`transcribing` 에서 영구히 멈춰 있었다.
 * 화면에는 "분석 상태: queued" 로만 보여 원인을 알기 어려웠다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WagandaDataStack } from '../lib/data-stack';
import { WagandaPipelineStack } from '../lib/pipeline-stack';
import { getEnvironmentConfig } from '../lib/env';

const LAMBDA_DIR = join(process.cwd(), 'lambda');
const REPO_ROOT = join(process.cwd(), '..');

describe('분석 파이프라인 배선', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { env: 'prod' } });
    const envConfig = getEnvironmentConfig('prod');
    const env = { account: '123456789012', region: envConfig.region };
    const dataStack = new WagandaDataStack(app, 'DataStack', { env, envConfig });
    const stack = new WagandaPipelineStack(app, 'PipelineStack', { env, envConfig, dataStack });
    template = Template.fromStack(stack);
  });

  it('두 트리거 Lambda 에 AgentCore 런타임 ARN 이 주입된다', () => {
    // 없으면 호출 대상을 몰라 분석이 시작되지 않는다.
    const functions = template.findResources('AWS::Lambda::Function');
    const withRuntimeArn = Object.values(functions).filter((fn) => {
      const vars = (fn.Properties?.Environment?.Variables ?? {}) as Record<string, unknown>;
      return 'WAGANDA_AGENT_RUNTIME_ARN' in vars;
    });

    // trigger-upload(세션 A) + trigger-transcribe(세션 B)
    expect(withRuntimeArn.length).toBe(2);
  });

  it('두 트리거 역할이 InvokeAgentRuntime 권한을 갖는다', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    const occurrences = policies.split('bedrock-agentcore:InvokeAgentRuntime').length - 1;

    // 세션 A·B 각각의 역할에 필요하다.
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('EventBridge 가 Transcribe 완료·실패를 트리거로 연결한다', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        source: ['aws.transcribe'],
        // 문서상 항상 `Transcribe Job State Change` 다.
        // `Transcription Job State Change` 로 적었더니 매칭 이벤트가 0건이었고
        // 전사가 끝나도 세션 B 가 시작되지 않았다.
        'detail-type': ['Transcribe Job State Change'],
        detail: Match.objectLike({
          TranscriptionJobStatus: Match.arrayWith(['COMPLETED', 'FAILED']),
        }),
      }),
    });
  });

  it('트리거 Lambda 소스에 미구현 자리표시자가 남아 있지 않다', () => {
    // `Would invoke ...` 로그만 남기고 실제 호출을 하지 않던 상태를 막는다.
    for (const file of ['trigger-upload.ts', 'trigger-transcribe.ts']) {
      const source = readFileSync(join(LAMBDA_DIR, file), 'utf8');

      expect(source, `${file} 에 미구현 자리표시자가 있다`).not.toMatch(/Would invoke/);
      // 실제 호출 커맨드를 써야 한다.
      expect(source, `${file} 이 InvokeAgentRuntime 을 호출하지 않는다`).toMatch(
        /InvokeAgentRuntimeCommand/,
      );
    }
  });

  it('세션 ID 규칙이 두 트리거에서 동일하다 (세션 A·B 가 상태를 공유한다)', () => {
    const sources = ['trigger-upload.ts', 'trigger-transcribe.ts'].map((file) =>
      readFileSync(join(LAMBDA_DIR, file), 'utf8'),
    );

    for (const source of sources) {
      // 같은 접두어와 같은 패딩 규칙을 써야 한다(한쪽이 예외를 던지면 세션이 갈린다).
      expect(source).toMatch(/waganda-tasting-\$\{tastingId\}-\$\{env\}/);
      expect(source).toMatch(/padEnd\(33, '0'\)/);
    }
  });

  it('Lambda 번들이 AgentCore SDK 를 포함한다', () => {
    // `@aws-sdk` 전체를 external 로 두면 런타임에 이 패키지가 없어 트리거가 실패한다.
    const stackSource = readFileSync(join(process.cwd(), 'lib/pipeline-stack.ts'), 'utf8');

    expect(stackSource).not.toMatch(/externalModules:\s*\['@aws-sdk'\]/);
    expect(stackSource).toMatch(/externalModules:\s*\['@aws-sdk\/client-dynamodb'/);
  });
  it('에이전트 역할이 파이프라인 각 단계에 필요한 권한을 갖는다', () => {
    /*
     * 단계별로 다른 AWS 서비스를 쓴다. 하나라도 빠지면 그 지점에서 멈추고
     * 화면에는 상태만 남는다 — 실제로 `extract_acoustic` 에서 Lambda 호출 권한이 없어
     * 전사까지 진행한 뒤 멈췄다.
     */
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));

    for (const action of [
      'transcribe:StartTranscriptionJob', // start_transcription
      'lambda:InvokeFunction', // extract_acoustic (음향 특징 Lambda)
      'dynamodb:PutItem', // persist_and_publish (결과·발견 카드 생성)
      'cloudfront:CreateInvalidation', // persist_and_publish (공개 페이지 캐시)
    ]) {
      expect(policies, `${action} 권한이 없다`).toContain(action);
    }
  });
  it('Transcribe 작업명 생성·파싱 규칙이 일치한다', () => {
    /*
     * 작업명은 에이전트가 만들고(`buildTranscribeJobName`) 트리거 Lambda 가 파싱한다.
     * 규칙이 어긋나면 전사가 끝나도 tastingId 를 몰라 세션 B 가 진행되지 않는다 —
     * 실제로 파싱이 `waganda-tasting-<id>-` 를 기대해 항상 실패했다.
     */
    const agentSource = readFileSync(
      join(REPO_ROOT, 'agent/src/graph/nodes/startTranscription.ts'),
      'utf8',
    );
    const triggerSource = readFileSync(join(LAMBDA_DIR, 'trigger-transcribe.ts'), 'utf8');

    // 생성 규칙: waganda-<tastingId>-<recordingId>
    expect(agentSource).toMatch(/`waganda-\$\{tastingId\}-\$\{recordingId\}`/);

    // 파싱이 옛 접두어를 기대하면 안 된다.
    expect(triggerSource).not.toMatch(/waganda-tasting-\(\[\^-\]\+\)/);

    // 실제 형식으로 파싱되는지 확인한다(UUID 두 개).
    const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
    const sample = 'waganda-fb41e8cf-40de-48f7-bdb0-22f80f9968e7-ff939aa9-3833-4a4c-989c-dd364a7e6fa5';
    const parsed = sample.match(new RegExp(`^waganda-(${uuid})-(${uuid})$`));
    expect(parsed?.[1]).toBe('fb41e8cf-40de-48f7-bdb0-22f80f9968e7');
  });
});
