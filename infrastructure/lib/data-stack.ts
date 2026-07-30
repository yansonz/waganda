/**
 * 데이터 스택 (WagandaDataStack)
 * - DynamoDB 단일 테이블 (온디맨드, PITR 활성화)
 * - 미디어 S3 버킷 (버전 관리, 퍼블릭 차단)
 * - 에이전트 세션 S3 버킷
 * - ECR 리포지토리 3개 (web, agent, audio)
 * - Bedrock 애플리케이션 추론 프로파일
 * - SSM SecureString 파라미터 (시크릿 참조)
 */
import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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

    // SSM SecureString 파라미터 (값은 배포 시 수동 주입)
    // 실제 값은 AWS Console에서 별도로 설정해야 함
    // CDK에서는 파라미터 이름만 정의하고 placeholder는 생성하지 않음

    // Google OAuth 클라이언트
    new ssm.StringParameter(this, 'GoogleClientIdParam', {
      parameterName: `/waganda/${envConfig.env}/google/client-id`,
      stringValue: 'PLACEHOLDER_DEPLOY_TIME_SET',
      description: 'Google OAuth Client ID',
    });

    new ssm.StringParameter(this, 'GoogleClientSecretParam', {
      parameterName: `/waganda/${envConfig.env}/google/client-secret`,
      stringValue: 'PLACEHOLDER_DEPLOY_TIME_SET',
      description: 'Google OAuth Client Secret',
    });

    // JWT 서명 키 (lib/config.ts의 'auth/jwt-secret' 경로와 일치)
    new ssm.StringParameter(this, 'JwtSignKeyParam', {
      parameterName: `/waganda/${envConfig.env}/auth/jwt-secret`,
      stringValue: 'PLACEHOLDER_DEPLOY_TIME_SET',
      description: 'JWT Signing Key (HS256)',
    });

    // 편집자 허용 목록 (쉼표 구분 이메일, lib/config.ts의 'auth/editor-allowlist' 경로와 일치)
    new ssm.StringParameter(this, 'AllowlistParam', {
      parameterName: `/waganda/${envConfig.env}/auth/editor-allowlist`,
      stringValue: 'PLACEHOLDER_DEPLOY_TIME_SET',
      description: 'Comma-separated list of allowed editor emails',
    });

    // Bedrock 애플리케이션 추론 프로파일
    // L1 리소스 사용 (CfnApplicationInferenceProfile)
    // 주의: 아직 CloudFormation L1이 없을 수 있으므로 실제 배포 시 콘솔에서 생성 또는
    // 향후 CfnResource 사용 필요
    // 현재는 구조만 유지
  }
}
