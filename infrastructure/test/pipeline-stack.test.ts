/**
 * 파이프라인 스택 테스트 (Requirement 17.1)
 * 
 * - DLQ maxReceiveCount = 3
 * - EventBridge 규칙 패턴 (COMPLETED/FAILED)
 * - AgentCore 상한값 명시 (설정이 가능하도록 구조화)
 */
import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { WagandaDataStack } from '../lib/data-stack';
import { WagandaPipelineStack } from '../lib/pipeline-stack';
import { getEnvironmentConfig } from '../lib/env';
import { Tags } from 'aws-cdk-lib';

describe('Pipeline Stack Validation', () => {
  function createPipelineStack(): WagandaPipelineStack {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('dev');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'dev');

    const dataStack = new WagandaDataStack(app, 'DataStack', {
      stackName: 'test-data-stack',
      envConfig,
    });

    return new WagandaPipelineStack(app, 'PipelineStack', {
      stackName: 'test-pipeline-stack',
      envConfig,
      dataStack,
    });
  }

  it('should create SQS queue with DLQ', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // 큐와 DLQ가 모두 존재해야 함
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  it('should set DLQ maxReceiveCount to 3', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: {
        deadLetterTargetArn: cdk.assertions.Match.anyValue(),
        maxReceiveCount: 3,
      },
    });
  });

  it('should create EventBridge rule for Transcribe job state change', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.transcribe'],
        'detail-type': ['Transcription Job State Change'],
        detail: {
          TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
        },
      },
    });
  });

  it('should create 2 Lambda functions for triggers', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // trigger-upload, trigger-transcribe 두 개의 trigger Lambda 확인
    template.resourcePropertiesCountIs('AWS::Lambda::Function', {
      FunctionName: cdk.assertions.Match.stringLikeRegexp('.*trigger-(upload|transcribe).*'),
    }, 2);
  });

  it('should create Lambda with appropriate timeout for SQS processing', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // 최소 하나의 Lambda는 15분 타임아웃이 필요
    template.resourcePropertiesCountIs('AWS::Lambda::Function', {
      Timeout: 900, // 15분
    }, 2);
  });

  it('should create audio processing Lambda with ARM64 architecture', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // AudioProcessorLambda는 DockerImageFunction으로 ARM64 아키텍처를 가짐
    // CloudFormation에서는 모든 Lambda 함수가 AWS::Lambda::Function으로 표현됨
    // 최소 1개 이상의 Lambda는 Architectures에 arm64를 포함해야 함
    template.resourcePropertiesCountIs('AWS::Lambda::Function', {
      Architectures: cdk.assertions.Match.arrayWith(['arm64']),
    }, 1);
  });

  it('should create EventBridge rule target with Lambda', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // EventBridge 규칙이 있고 Lambda target을 가지고 있는지 확인
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: cdk.assertions.Match.arrayWith([
        cdk.assertions.Match.objectLike({
          Arn: cdk.assertions.Match.anyValue(), // Fn::GetAtt 또는 문자열
          // RoleArn은 events_targets.LambdaFunction에서 자동 생성되거나 선택사항
        }),
      ]),
    });
  });

  it('should create EventBridge rule with proper names', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Events::Rule', {
      Name: cdk.assertions.Match.stringLikeRegexp('waganda-transcribe-complete-.*'),
    });
  });

  it('should create SQS queue with proper visibility timeout', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // 메인 큐는 15분 타임아웃이 필요
    template.resourcePropertiesCountIs('AWS::SQS::Queue', {
      VisibilityTimeout: 900,
    }, 1);
  });

  it('should connect S3 upload event to SQS queue with audio/ prefix', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // S3 NotificationConfiguration이 존재하여 audio/ 프리픽스의 이벤트를 SQS로 라우팅하는지 확인
    const resources = template.toJSON().Resources;
    let hasS3Notification = false;

    for (const [_name, resource] of Object.entries(resources || {})) {
      const resObj = resource as Record<string, unknown>;
      const props = resObj.Properties as Record<string, unknown> | undefined;
      const notifConfig = props?.NotificationConfiguration as Record<string, unknown> | undefined;
      const queueConfigs = notifConfig?.QueueConfigurations as Array<Record<string, unknown>> | undefined;
      if (queueConfigs) {
        const hasAudioPrefix = queueConfigs.some((config: Record<string, unknown>) => {
          const filter = config.Filter as Record<string, unknown> | undefined;
          const key = filter?.Key as Record<string, unknown> | undefined;
          const rules = key?.FilterRules as Array<Record<string, unknown>> | undefined;
          return rules?.some((rule: Record<string, unknown>) => 
            rule.Name === 'prefix' && rule.Value === 'audio/'
          );
        });
        if (hasAudioPrefix) {
          hasS3Notification = true;
          break;
        }
      }
    }

    expect(hasS3Notification).toBe(true);
  });

  it('should create AgentCore Runtime with configured limits', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // AgentCore Runtime L1 리소스 확인
    // 배포 전 스키마 재확인 필요
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      maxIterations: 12,
      timeoutSeconds: 300,
      idleRuntimeSessionTimeout: 60,
      maxLifetime: 900,
    });
  });
});
