/**
 * 데이터 스택 (WagandaDataStack)
 * - DynamoDB 단일 테이블 (온디맨드, PITR 활성화)
 * - 미디어 S3 버킷 (버전 관리, 퍼블릭 차단)
 * - 에이전트 세션 S3 버킷
 * - ECR 리포지토리 3개 (web, agent, audio)
 */
import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvironmentConfig } from './env';

export interface DataStackProps extends StackProps {
  envConfig: EnvironmentConfig;
}

export class WagandaDataStack extends Stack {
  public readonly tastingTable: dynamodb.Table;
  public readonly mediaBucket: s3.Bucket;
  public readonly sessionBucket: s3.Bucket;
  public readonly webEcrRepo: ecr.Repository;
  public readonly agentEcrRepo: ecr.Repository;
  public readonly audioEcrRepo: ecr.Repository;
  /** Claude Haiku 4.5 (기본 모델) */
  public readonly haikuProfile: bedrock.CfnApplicationInferenceProfile;
  /** Claude Sonnet 4.6 */
  public readonly sonnetProfile: bedrock.CfnApplicationInferenceProfile;
  /** Claude Opus 5 */
  public readonly opusProfile: bedrock.CfnApplicationInferenceProfile;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { envConfig } = props;

    // DynamoDB 단일 테이블
    // PK: pk, SK: sk
    // GSI1: gsi1pk, gsi1sk
    this.tastingTable = new dynamodb.Table(this, 'TastingTable', {
      tableName: `waganda-${envConfig.resourceSuffix}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // 온디맨드
      removalPolicy: envConfig.removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl', // TTL 속성
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI1: gsi1pk / gsi1sk
    this.tastingTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 미디어 S3 버킷 (버전 관리, 퍼블릭 차단)
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: `waganda-media-${envConfig.resourceSuffix}`,
      versioned: true, // 버전 관리 활성화
      removalPolicy: envConfig.removalPolicy,
      autoDeleteObjects: envConfig.removalPolicy === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // 퍼블릭 접근 차단
      /**
       * 브라우저가 **사전 서명 URL 로 직접** 올리기 때문에 CORS 가 필요하다
       * (라벨 사진·녹음 파일은 서버를 거치지 않고 S3 로 간다 — `lib/upload/presign.ts`).
       * 규칙이 없으면 preflight 가 막혀 업로드가 네트워크 오류로 실패한다
       * ("사진 저장소에 연결하지 못했습니다").
       *
       * 읽기는 CloudFront(OAC)를 통하므로 여기서는 업로드에 필요한 것만 허용한다.
       * 오리진은 서비스 도메인으로 한정한다 — 사전 서명 URL 이 유출돼도 다른 사이트에서
       * 브라우저를 통해 쓰지 못하게 막는다.
       */
      cors: [
        {
          allowedOrigins: [`https://${envConfig.domain}`],
          allowedMethods: [s3.HttpMethods.PUT],
          // 사전 서명 PUT 은 Content-Type 을 보내고, 브라우저가 preflight 에서 확인한다.
          allowedHeaders: ['content-type'],
          // 업로드 성공 확인에 쓰는 최소 응답 헤더만 노출한다.
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    });

    // 정적 자산 S3 버킷
    this.sessionBucket = new s3.Bucket(this, 'SessionBucket', {
      bucketName: `waganda-sessions-${envConfig.resourceSuffix}`,
      versioned: false,
      removalPolicy: envConfig.removalPolicy,
      autoDeleteObjects: envConfig.removalPolicy === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // CloudFront(OAC)가 미디어 객체를 읽을 수 있게 허용한다.
    //
    // WebStack 에서 정책을 붙이면 정책 리소스가 이 스택에 생성되면서 배포 ARN 을
    // 크로스 스택으로 참조해 `DataStack ↔ WebStack` 순환 의존이 발생한다.
    // 그래서 이 스택 안에서 **계정 범위 조건**으로 부여한다 —
    // 같은 계정의 CloudFront 서비스 주체만 GetObject 할 수 있고,
    // 이 계정에는 이 프로젝트의 배포만 존재하므로(전용 계정) 범위가 충분히 좁다.
    this.mediaBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontOacRead',
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [this.mediaBucket.arnForObjects('*')],
        conditions: {
          StringEquals: { 'AWS:SourceAccount': this.account },
        },
      }),
    );

    // ECR 리포지토리 3개 (이미지 스캔 활성화, lifecycle 규칙)
    const createEcrRepo = (repoName: string): ecr.Repository => {
      const repo = new ecr.Repository(this, `${repoName}Repo`, {
        repositoryName: `waganda-${repoName}`,
        removalPolicy: envConfig.removalPolicy,
        imageScanOnPush: true, // 이미지 스캔 활성화
      });

      // 오래된 이미지 정리 (최신 10개만 유지)
      repo.addLifecycleRule({
        tagStatus: ecr.TagStatus.ANY,
        maxImageCount: 10,
      });

      return repo;
    };

    this.webEcrRepo = createEcrRepo('web');
    this.agentEcrRepo = createEcrRepo('agent');
    this.audioEcrRepo = createEcrRepo('audio');

    /**
     * Bedrock 애플리케이션 추론 프로파일.
     *
     * Bedrock 은 온디맨드 모델 ID 를 거부하고 **추론 프로파일**로만 호출된다.
     * 시스템 정의 `global.*` 프로파일을 그대로 쓰면 비용을 태그로 귀속시킬 수 없으므로,
     * 태그가 붙은 애플리케이션 프로파일을 만들어 그 ARN 으로 호출한다
     * (앱 수준 태깅으로 Project=waganda / Environment 가 붙는다).
     *
     * `global.` 접두 프로파일은 리전 경계 없이 라우팅해 스로틀링을 줄인다.
     * ARN 은 생성 시 임의 ID 가 붙어 예측할 수 없으므로 출력으로 노출하고,
     * 소비 스택(web/pipeline)은 컨텍스트로 받는다.
     */
    const createInferenceProfile = (
      id: string,
      name: string,
      sourceProfileId: string,
    ): bedrock.CfnApplicationInferenceProfile =>
      new bedrock.CfnApplicationInferenceProfile(this, id, {
        inferenceProfileName: name,
        // Description 패턴은 `^([0-9a-zA-Z:.][ _-]?)+$` 다 —
        // 특수문자를 연속으로 쓸 수 없어 ` - ` 같은 구분자를 넣으면 배포가 거부된다.
        description: `Waganda ${envConfig.env} ${sourceProfileId}`,
        modelSource: {
          copyFrom: `arn:aws:bedrock:${envConfig.region}:${this.account}:inference-profile/${sourceProfileId}`,
        },
      });

    this.haikuProfile = createInferenceProfile(
      'HaikuInferenceProfile',
      `waganda-haiku-4-5-${envConfig.resourceSuffix}`,
      'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    );
    this.sonnetProfile = createInferenceProfile(
      'SonnetInferenceProfile',
      `waganda-sonnet-4-6-${envConfig.resourceSuffix}`,
      'global.anthropic.claude-sonnet-4-6',
    );
    this.opusProfile = createInferenceProfile(
      'OpusInferenceProfile',
      `waganda-opus-5-${envConfig.resourceSuffix}`,
      'global.anthropic.claude-opus-5',
    );

    // 프로파일 ARN 은 예측 불가하므로 출력으로 노출한다.
    // 재배포 시 `-c bedrockModelProfileArn=<haiku ARN>` 으로 소비 스택에 주입한다.
    new CfnOutput(this, 'HaikuInferenceProfileArnOutput', {
      value: this.haikuProfile.attrInferenceProfileArn,
      description: 'Claude Haiku 4.5 application inference profile ARN',
    });
    new CfnOutput(this, 'SonnetInferenceProfileArnOutput', {
      value: this.sonnetProfile.attrInferenceProfileArn,
      description: 'Claude Sonnet 4.6 application inference profile ARN',
    });
    new CfnOutput(this, 'OpusInferenceProfileArnOutput', {
      value: this.opusProfile.attrInferenceProfileArn,
      description: 'Claude Opus 5 application inference profile ARN',
    });

    // AgentCore Runtime 이 에이전트 이미지를 가져올 수 있게 리포지토리 측에서도 허용한다.
    // 실행 역할 권한만으로는 서비스 주체가 리포지토리 정책에 막히는 경우가 있어 양쪽을 모두 부여한다.
    // 범위는 같은 계정의 AgentCore 서비스로 제한한다.
    this.agentEcrRepo.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowAgentCorePull',
        principals: [new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com')],
        actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'],
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
        },
      }),
    );

    /**
     * SSM SecureString 파라미터는 CDK에서 생성하지 않는다.
     * 이유:
     * 1. CloudFormation은 SecureString 파라미터를 생성할 수 없다.
     *    `aws ssm put-parameter --type SecureString` 으로만 생성 가능.
     * 2. 배포 전에 사람이 AWS CLI로 수동 생성하고, CDK는 생성하지 않는다.
     * 3. 파라미터 이름 규약은 아래 상수로 노출된다.
     * 배포 워크플로: infrastructure/scripts/put-secrets.sh 참조.
     */
  }

  /**
   * SSM SecureString 파라미터 이름 규약.
   * 배포 전에 사람이 AWS CLI로 이름 기반으로 생성해야 한다.
   * 예: aws ssm put-parameter --name /waganda/prod/google/client-id --type SecureString --value "..."
   */
  public static readonly SSM_PARAM_NAMES = {
    googleClientId: (env: string) => `/waganda/${env}/google/client-id`,
    googleClientSecret: (env: string) => `/waganda/${env}/google/client-secret`,
    jwtSecret: (env: string) => `/waganda/${env}/auth/jwt-secret`,
    editorAllowlist: (env: string) => `/waganda/${env}/auth/editor-allowlist`,
    /** 라벨 보강용 웹 검색 키. **선택 항목**이며 없으면 검색 없이 보강한다. */
    serpApiKey: (env: string) => `/waganda/${env}/search/serpapi-key`,
  } as const;
}
