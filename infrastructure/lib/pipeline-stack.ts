/**
 * 파이프라인 스택 (WagandaPipelineStack)
 * - SQS 큐 + DLQ
 * - S3 업로드 이벤트 → SQS 알림
 * - Lambda 트리거 2개 (trigger-upload, trigger-transcribe, NodejsFunction esbuild 번들링)
 * - EventBridge 규칙
 * - 오디오 Lambda (컨테이너, ARM64)
 * - AgentCore Runtime L1 리소스 (올바른 스키마)
 * - IAM 역할 (최소 권한)
 */
import { Stack, StackProps, Duration, CfnOutput, CfnResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3_notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { WagandaDataStack } from './data-stack';
import { EnvironmentConfig, resourceNames } from './env';

export interface PipelineStackProps extends StackProps {
  envConfig: EnvironmentConfig;
  dataStack: WagandaDataStack;
  /**
   * CloudFront 배포 ID (컨텍스트 주입).
   * WebStack 소유 리소스라 크로스 스택 참조 대신 컨텍스트로 받는다.
   * 없으면 에이전트의 캐시 무효화가 no-op 이다.
   */
  cloudFrontDistributionId?: string;
  /**
   * Bedrock 추론 프로파일 ARN (컨텍스트 주입).
   * 온디맨드 모델 ID 는 거부되므로 이 값이 없으면 모델 호출이 실패한다.
   */
  bedrockModelProfileArn?: string;
}

export class WagandaPipelineStack extends Stack {
  public readonly queue: sqs.Queue;
  public readonly dlq: sqs.DeadLetterQueue;
  public readonly agentCoreRuntimeArn: string;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { envConfig, dataStack, cloudFrontDistributionId, bedrockModelProfileArn } = props;
    const names = resourceNames(envConfig);

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
      names.mediaBucket,
    );

    // audio/ 프리픽스로 제한된 S3 업로드 이벤트를 SQS로 알림
    mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3_notifications.SqsDestination(this.queue),
      { prefix: 'audio/' }, // audio/ 폴더 내 파일만 모니터링
    );

    // 오디오 Lambda (컨테이너, ARM64)
    // 이미지 태그는 AgentCore Runtime 과 같은 값을 쓴다(아래 imageTag 참조).
    const audioLambda = new lambda.DockerImageFunction(this, 'AudioProcessorLambda', {
      code: lambda.DockerImageCode.fromEcr(dataStack.audioEcrRepo, {
        tagOrDigest: process.env.WAGANDA_IMAGE_TAG || 'latest',
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.minutes(10),
      environment: {
        MEDIA_BUCKET_NAME: names.mediaBucket,
      },
    });

    // 오디오 Lambda에 미디어 버킷 읽기 권한 부여
    mediaBucket.grantRead(audioLambda);

    // ─── AgentCore 실행 Role ──────────────────────────────────────
    // 신뢰 주체: bedrock-agentcore.amazonaws.com
    // 권한: Bedrock InvokeModel/Converse, Transcribe, S3, DynamoDB, CloudWatch Logs
    // IAM 의 description 은 ASCII/Latin-1 만 허용한다(한글을 넣으면 배포가 400 으로 거부된다).
    const agentCoreExecutionRole = new iam.Role(
      this,
      'AgentCoreExecutionRole',
      {
        assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        description: 'AgentCore Runtime execution role',
      },
    );

    // Bedrock InvokeModel/Converse 권한
    // 추론 프로파일로만 호출하되, 프로파일이 라우팅하는 파운데이션 모델에도 권한이 필요하다.
    // `global.*` 프로파일은 리전 경계를 넘어 라우팅하므로 모델 ARN 의 리전을 제한하지 않는다.
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockInference',
        actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:${envConfig.region}:${this.account}:inference-profile/*`,
          `arn:aws:bedrock:${envConfig.region}:${this.account}:application-inference-profile/*`,
        ],
      }),
    );

    // Transcribe 작업 시작·조회 권한
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'TranscribeOperations',
        actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
        resources: [`arn:aws:transcribe:${envConfig.region}:${this.account}:transcription-job/*`],
      }),
    );

    // 미디어 버킷 읽기/쓰기 (녹음 파일 읽고, Transcribe 결과 씀)
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'MediaBucketAccess',
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`arn:aws:s3:::${names.mediaBucket}/*`],
      }),
    );

    // 세션 버킷 읽기/쓰기 (에이전트 세션 저장)
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SessionBucketAccess',
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`arn:aws:s3:::${names.sessionBucket}/*`],
      }),
    );

    // DynamoDB 테이블 읽기/쓰기 (분석 결과 저장)
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'DynamoDBAccess',
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:Scan'],
        resources: [
          `arn:aws:dynamodb:${envConfig.region}:${this.account}:table/${names.table}`,
          `arn:aws:dynamodb:${envConfig.region}:${this.account}:table/${names.table}/index/*`,
        ],
      }),
    );

    // SSM Parameter Store 읽기 — 라벨 보강용 검색 키(`search/serpapi-key`) 등 선택 시크릿.
    // 키를 Runtime 환경변수에 평문으로 두지 않기 위해 런타임에 읽는다.
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SSMParameterRead',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${envConfig.region}:${this.account}:parameter/waganda/${envConfig.env}/*`,
        ],
      }),
    );

    // KMS 복호화 (SSM SecureString 복호화)
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'KMSDecrypt',
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${envConfig.region}:${this.account}:alias/aws/ssm`],
      }),
    );

    // ECR 이미지 pull (AgentCore Runtime 이 컨테이너를 가져올 때 사용)
    // 이 권한이 없으면 Runtime 생성 자체가 ECR URI 검증 단계에서 400 으로 거부된다.
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'EcrImagePull',
        actions: [
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
        ],
        resources: [
          `arn:aws:ecr:${envConfig.region}:${this.account}:repository/${names.ecr.agent}`,
        ],
      }),
    );

    // GetAuthorizationToken 은 리소스를 지정할 수 없다(계정 범위 토큰 발급).
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'EcrAuthToken',
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );

    // CloudWatch Logs 쓰기 (디버깅·모니터링)
    agentCoreExecutionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogs',
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`arn:aws:logs:${envConfig.region}:${this.account}:*`],
      }),
    );

    // ─── AgentCore Runtime L1 리소스 ────────────────────────────
    // AWS::BedrockAgentCore::Runtime 스키마:
    // - AgentRuntimeName (필수): 패턴 [a-zA-Z][a-zA-Z0-9_]{0,47} (밑줄만, 하이픈 X)
    // - AgentRuntimeArtifact (필수): { ContainerConfiguration: { ContainerUri: String } }
    // - NetworkConfiguration (필수): { NetworkMode: 'PUBLIC' | 'VPC' }
    // - RoleArn (필수): 실행 역할 ARN
    // - LifecycleConfiguration (선택): { IdleRuntimeSessionTimeout, MaxLifetime }
    // - ProtocolConfiguration (선택): 'MCP' | 'HTTP' | 'A2A' | 'AGUI'
    // - EnvironmentVariables (선택): Object<String, String>

    // 이미지 태그는 환경변수 또는 'latest' 폴백
    const imageTag = process.env.WAGANDA_IMAGE_TAG || 'latest';
    const containerUri = `${this.account}.dkr.ecr.${envConfig.region}.amazonaws.com/${names.ecr.agent}:${imageTag}`;

    // RuntimeName: 환경과 계정 기반으로 생성 (패턴: [a-zA-Z][a-zA-Z0-9_]{0,47})
    // 예: waganda_agent_prod (밑줄 사용, 하이픈 X)
    const runtimeName = `waganda_agent_${envConfig.resourceSuffix}`.substring(0, 48);

    // AWS::BedrockAgentCore::Runtime L1 리소스
    const agentCoreRuntime = new CfnResource(this, 'AgentCoreRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: runtimeName,
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: containerUri,
          },
        },
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC', // 상시 과금(NAT) 방지
        },
        RoleArn: agentCoreExecutionRole.roleArn,
        LifecycleConfiguration: {
          IdleRuntimeSessionTimeout: 60, // 유휴 세션 종료 시간(초), 범위: 60~28800
          MaxLifetime: 900, // 세션 최대 수명(초), 범위: 60~28800
        },
        ProtocolConfiguration: 'HTTP',
        // 에이전트는 `lib/config.ts` 의 `getRuntimeConfig()` 를 거치므로
        // WAGANDA_TABLE_NAME·WAGANDA_MEDIA_BUCKET·APP_BASE_URL 이 없으면 즉시 실패한다.
        // **시크릿은 여기에 넣지 않는다** — 평문으로 템플릿·콘솔에 남는다.
        // 검색 키 같은 시크릿은 런타임에 SSM SecureString 에서 읽는다.
        EnvironmentVariables: {
          WAGANDA_ENV: envConfig.env,
          WAGANDA_TABLE_NAME: names.table,
          WAGANDA_MEDIA_BUCKET: names.mediaBucket,
          APP_BASE_URL: `https://${envConfig.domain}`,
          // **AgentCore Runtime 은 `AWS_REGION` 을 주지 않는다**(Lambda 와 다르다).
          // 없으면 SDK 클라이언트 생성 단계에서 즉시 실패해 모든 분석 요청이 500 이 된다.
          AWS_REGION: envConfig.region,
          // entrypoint 가 읽는 이름 (위의 WAGANDA_* 와 별개 규약)
          MEDIA_BUCKET: names.mediaBucket,
          AUDIO_LAMBDA_FUNCTION_NAME: audioLambda.functionName,
          ...(cloudFrontDistributionId
            ? { CLOUDFRONT_DISTRIBUTION_ID: cloudFrontDistributionId }
            : {}),
          ...(bedrockModelProfileArn
            ? { MODEL_INFERENCE_PROFILE_ARN: bedrockModelProfileArn }
            : {}),
        },
      },
    });

    // 실행 역할의 인라인 정책(DefaultPolicy)이 만들어지기 **전에** Runtime 생성이 시도되면
    // AgentCore 가 ECR URI 검증에 실패해 `Access denied while validating ECR URI` 로 거부한다.
    // Runtime 은 RoleArn 문자열만 참조하므로 CloudFormation 이 정책 생성을 기다리지 않는다.
    // 역할 construct 전체(Role + DefaultPolicy)에 의존을 걸어 순서를 강제한다.
    agentCoreRuntime.node.addDependency(agentCoreExecutionRole);

    // Runtime ARN 추출 (Fn::GetAtt로 제공)
    // 패턴: arn:aws:bedrock:<region>:<account>:agent-runtime/<runtimeId>
    this.agentCoreRuntimeArn = agentCoreRuntime.getAtt('AgentRuntimeArn').toString();

    // ─── trigger-upload Lambda (NodejsFunction esbuild 번들링) ───
    const triggerUploadRole = new iam.Role(this, 'TriggerUploadRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // SQS 읽기 권한
    this.queue.grantConsumeMessages(triggerUploadRole);

    // DynamoDB 쓰기 권한
    const tastingTable = dynamodb.Table.fromTableName(this, 'TastingTableRef', names.table);
    tastingTable.grantWriteData(triggerUploadRole);

    // AgentCore InvokeAgentRuntime 권한
    // 런타임 ARN 자체와 그 하위 엔드포인트를 모두 대상으로 한다.
    triggerUploadRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeAgentRuntime',
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [this.agentCoreRuntimeArn, `${this.agentCoreRuntimeArn}/runtime-endpoint/*`],
      }),
    );

    const triggerUploadLambda = new lambda_nodejs.NodejsFunction(
      this,
      'TriggerUploadLambda',
      {
        functionName: `waganda-trigger-upload-${envConfig.resourceSuffix}`,
        entry: 'lambda/trigger-upload.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        role: triggerUploadRole,
        timeout: Duration.minutes(15),
        memorySize: 512,
        architecture: lambda.Architecture.ARM_64,
        bundling: {
          externalModules: ['@aws-sdk'],
          minify: true,
          sourceMap: false,
        },
        environment: {
          TABLE_NAME: names.table,
          ENVIRONMENT: envConfig.env,
          WAGANDA_AGENT_RUNTIME_ARN: this.agentCoreRuntimeArn,
        },
      },
    );

    // SQS 이벤트 소스 매핑
    triggerUploadLambda.addEventSourceMapping('SqsEventSourceMapping', {
      eventSourceArn: this.queue.queueArn,
      batchSize: 1, // 한 번에 하나씩 처리
    });

    // ─── trigger-transcribe Lambda (NodejsFunction) ────────────
    const triggerTranscribeRole = new iam.Role(this, 'TriggerTranscribeRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    tastingTable.grantReadWriteData(triggerTranscribeRole);

    const triggerTranscribeLambda = new lambda_nodejs.NodejsFunction(
      this,
      'TriggerTranscribeLambda',
      {
        functionName: `waganda-trigger-transcribe-${envConfig.resourceSuffix}`,
        entry: 'lambda/trigger-transcribe.ts',
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        role: triggerTranscribeRole,
        timeout: Duration.minutes(15),
        memorySize: 512,
        architecture: lambda.Architecture.ARM_64,
        bundling: {
          externalModules: ['@aws-sdk'],
          minify: true,
          sourceMap: false,
        },
        environment: {
          TABLE_NAME: names.table,
          ENVIRONMENT: envConfig.env,
        },
      },
    );

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

    // ─── 출력 ────────────────────────────────────────────────────
    new CfnOutput(this, 'AgentCoreRuntimeArnOutput', {
      value: this.agentCoreRuntimeArn,
      exportName: `waganda-agent-runtime-arn-${envConfig.resourceSuffix}`,
      description: 'AgentCore Runtime ARN for web Lambda',
    });

    new CfnOutput(this, 'QueueUrlOutput', {
      value: this.queue.queueUrl,
      exportName: `waganda-audio-queue-url-${envConfig.resourceSuffix}`,
    });
  }
}
