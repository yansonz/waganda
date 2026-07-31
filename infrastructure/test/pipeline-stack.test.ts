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
    const envConfig = getEnvironmentConfig('prod');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'prod');

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

  it('오디오 Lambda 는 컨테이너 이미지로 ARM64 에서 돈다', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // 오디오 Lambda 만 PackageType=Image 다(트리거 2개는 zip 번들).
    template.resourcePropertiesCountIs(
      'AWS::Lambda::Function',
      {
        PackageType: 'Image',
        Architectures: cdk.assertions.Match.arrayWith(['arm64']),
      },
      1,
    );
  });

  it('우리가 정의한 Lambda 3개(오디오·트리거 2개)는 모두 ARM64 다', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // S3 알림 설정용 CDK 커스텀 리소스 핸들러는 CDK 가 만들며 아키텍처를 지정하지 않는다.
    // 그래서 arm64 로 지정된 함수의 개수만 단정한다.
    template.resourcePropertiesCountIs(
      'AWS::Lambda::Function',
      {
        Architectures: ['arm64'],
      },
      3,
    );
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

  it('AgentCore Runtime 은 퍼블릭 네트워크와 세션 수명 제한으로 만들어진다', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // AWS::BedrockAgentCore::Runtime 의 실제 스키마를 단정한다.
    // NetworkMode=PUBLIC 은 NAT 상시 과금을 피하기 위한 결정이다.
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      AgentRuntimeName: 'waganda_agent_prod',
      NetworkConfiguration: { NetworkMode: 'PUBLIC' },
      ProtocolConfiguration: 'HTTP',
      LifecycleConfiguration: {
        IdleRuntimeSessionTimeout: 60,
        MaxLifetime: 900,
      },
    });
  });

  it('AgentCore Runtime 에 필수 환경변수가 주입되고 시크릿은 들어가지 않는다', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // 에이전트는 lib/config.ts 의 getRuntimeConfig() 를 거치므로 이 값들이 없으면 즉시 실패한다.
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      EnvironmentVariables: cdk.assertions.Match.objectLike({
        WAGANDA_ENV: 'prod',
        WAGANDA_TABLE_NAME: 'waganda-prod',
        WAGANDA_MEDIA_BUCKET: 'waganda-media-prod',
        // AgentCore Runtime 은 Lambda 와 달리 AWS_REGION 을 주지 않는다.
        // 없으면 SDK 클라이언트 생성에서 실패해 모든 분석 요청이 500 이 된다(실제로 겪었다).
        AWS_REGION: 'ap-northeast-2',
      }),
    });

    // 시크릿(검색 키)은 환경변수로 넣지 않는다 — 평문으로 템플릿·콘솔에 남기 때문이다.
    const runtimes = template.findResources('AWS::BedrockAgentCore::Runtime');
    for (const runtime of Object.values(runtimes)) {
      const envVars = (runtime.Properties?.EnvironmentVariables ?? {}) as Record<string, unknown>;
      expect(Object.keys(envVars)).not.toContain('SERPAPI_KEY');
    }
  });

  it('AgentCore 실행 역할이 SSM SecureString 을 읽을 수 있다 (검색 키 조회)', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: cdk.assertions.Match.objectLike({
        Statement: cdk.assertions.Match.arrayWith([
          cdk.assertions.Match.objectLike({
            Sid: 'SSMParameterRead',
            Action: ['ssm:GetParameter', 'ssm:GetParameters'],
          }),
        ]),
      }),
    });
  });
  it('AgentCore 실행 역할이 Bedrock 스트리밍 호출을 할 수 있다', () => {
    const stack = createPipelineStack();
    const template = Template.fromStack(stack);

    // Strands SDK 는 기본적으로 스트리밍으로 모델을 부른다.
    // `InvokeModelWithResponseStream` 이 없으면 모든 모델 호출이 AccessDenied 가 된다.
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: cdk.assertions.Match.objectLike({
        Statement: cdk.assertions.Match.arrayWith([
          cdk.assertions.Match.objectLike({
            Sid: 'BedrockInference',
            Action: cdk.assertions.Match.arrayWith([
              'bedrock:InvokeModelWithResponseStream',
              'bedrock:ConverseStream',
            ]),
          }),
        ]),
      }),
    });
  });
});
