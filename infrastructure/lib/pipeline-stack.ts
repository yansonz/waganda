/**
 * 파이프라인 스택 (WagandaPipelineStack)
 * - SQS 큐 + DLQ
 * - S3 업로드 이벤트 → SQS 알림
 * - Lambda 트리거 2개 (trigger-upload, trigger-transcribe)
 * - EventBridge 규칙
 * - 오디오 Lambda (컨테이너, ARM64)
 * - AgentCore Runtime + RuntimeEndpoint
 * - IAM 역할
 */
import { Stack, StackProps, Duration, CfnResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3_notifications from 'aws-cdk-lib/aws-s3-notifications';
import { WagandaDataStack } from './data-stack';
import { EnvironmentConfig } from './env';

export interface PipelineStackProps extends StackProps {
  envConfig: EnvironmentConfig;
  dataStack: WagandaDataStack;
}

export class WagandaPipelineStack extends Stack {
  public readonly queue: sqs.Queue;
  public readonly dlq: sqs.DeadLetterQueue;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { envConfig, dataStack } = props;

    // DLQ 생성
    const deadLetterQueue = new sqs.Queue(this, 'AudioUploadDLQ', {
      queueName: `waganda-audio-dlq-${envConfig.resourceSuffix}`,
      visibilityTimeout: Duration.seconds(300),
    });

    this.dlq = {
      queue: deadLetterQueue,
      maxReceiveCount: 3,
    };

    // SQS 큐
    this.queue = new sqs.Queue(this, 'AudioUploadQueue', {
      queueName: `waganda-audio-queue-${envConfig.resourceSuffix}`,
      visibilityTimeout: Duration.minutes(15), // Lambda timeout과 동기화
      deadLetterQueue: this.dlq,
      retentionPeriod: Duration.days(14),
    });

    // S3 업로드 이벤트 → SQS 알림
    // Bucket.fromBucketName을 사용하여 순환 의존성 방지
    // (DataStack의 mediaBucket을 직접 참조하지 않고 이름만 사용)
    const mediaBucket = s3.Bucket.fromBucketName(
      this,
      'MediaBucketRef',
      dataStack.mediaBucket.bucketName,
    );

    // audio/ 프리픽스로 제한된 S3 업로드 이벤트를 SQS로 알림
    mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3_notifications.SqsDestination(this.queue),
      { prefix: 'audio/' }, // audio/ 폴더 내 파일만 모니터링
    );

    // 오디오 Lambda (컨테이너, ARM64)
    const audioLambda = new lambda.DockerImageFunction(this, 'AudioProcessorLambda', {
      code: lambda.DockerImageCode.fromEcr(dataStack.audioEcrRepo, {
        tag: 'latest',
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.minutes(10),
      environment: {
        MEDIA_BUCKET_NAME: dataStack.mediaBucket.bucketName,
      },
    });

    // 오디오 Lambda에 미디어 버킷 읽기 권한 부여
    dataStack.mediaBucket.grantRead(audioLambda);

    // trigger-upload Lambda (NodejsFunction으로 TS 직접 실행)
    const triggerUploadRole = new iam.Role(this, 'TriggerUploadRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // SQS 읽기 권한
    this.queue.grantConsumeMessages(triggerUploadRole);

    // DynamoDB 쓰기 권한
    dataStack.tastingTable.grantWriteData(triggerUploadRole);

    // AgentCore InvokeAgentRuntime 권한은 여기서는 준비만 함
    // (실제 ARN은 AgentCore 리소스 생성 후 추가)

    const triggerUploadLambda = new lambda.Function(this, 'TriggerUploadLambda', {
      functionName: `waganda-trigger-upload-${envConfig.resourceSuffix}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'trigger-upload.handler',
      code: lambda.Code.fromAsset('lambda', {
        exclude: ['*.test.ts', '*.md'],
      }),
      role: triggerUploadRole,
      timeout: Duration.minutes(15),
      memorySize: 512,
      environment: {
        TABLE_NAME: dataStack.tastingTable.tableName,
        ENVIRONMENT: envConfig.env,
      },
    });

    // SQS 이벤트 소스 매핑
    triggerUploadLambda.addEventSourceMapping('SqsEventSourceMapping', {
      eventSourceArn: this.queue.queueArn,
      batchSize: 1, // 한 번에 하나씩 처리
    });

    // trigger-transcribe Lambda (EventBridge 트리거)
    const triggerTranscribeRole = new iam.Role(this, 'TriggerTranscribeRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    dataStack.tastingTable.grantReadWriteData(triggerTranscribeRole);

    const triggerTranscribeLambda = new lambda.Function(this, 'TriggerTranscribeLambda', {
      functionName: `waganda-trigger-transcribe-${envConfig.resourceSuffix}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'trigger-transcribe.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: triggerTranscribeRole,
      timeout: Duration.minutes(15),
      memorySize: 512,
      environment: {
        TABLE_NAME: dataStack.tastingTable.tableName,
        ENVIRONMENT: envConfig.env,
      },
    });

    // EventBridge 규칙 (Transcribe Job State Change)
    const transcribeEventRule = new events.Rule(this, 'TranscribeEventRule', {
      ruleName: `waganda-transcribe-complete-${envConfig.resourceSuffix}`,
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcription Job State Change'],
        detail: {
          TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
        },
      },
    });

    transcribeEventRule.addTarget(
      new events_targets.LambdaFunction(triggerTranscribeLambda),
    );

    // AgentCore Runtime 설정 (L1 리소스: CfnResource 사용)
    // CloudFormation 타입: AWS::BedrockAgentCore::Runtime
    // 배포 전 스키마 재확인 필요 — 속성명과 값이 정확한지 Bedrock 문서 확인
    // 참고: design.md의 상한값 (maxIterations 12, timeoutSeconds 300, 
    //       idleRuntimeSessionTimeout 60, maxLifetime 900)
    new CfnResource(this, 'AgentCoreRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        // 배포 전 스키마 재확인 필요
        maxIterations: 12, // 도구 호출 최대 횟수
        timeoutSeconds: 300, // 분석 1건 목표 시간 (5분)
        idleRuntimeSessionTimeout: 60, // 유휴 세션 종료 시간 (1분)
        maxLifetime: 900, // 세션 최대 수명 (15분)
      },
    });
  }
}
