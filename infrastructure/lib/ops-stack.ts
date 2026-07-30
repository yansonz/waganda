/**
 * 운영 스택 (WagandaOpsStack)
 * - CloudWatch 로그 그룹 (14일 보관)
 * - AWS Budgets (Project 태그 필터)
 * - SNS 알림 토픽
 * - CloudWatch 알람 (실패율, 지연시간, 스키마 검증 실패율)
 */
import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvironmentConfig, resourceNames } from './env';

/**
 * OIDC 신뢰를 허용할 GitHub 저장소.
 * 이 값이 신뢰 정책의 유일한 경계이므로 상수로 고정한다(오타가 곧 보안 구멍이다).
 */
const GITHUB_REPOSITORY = 'yansonz/waganda';

export interface OpsStackProps extends StackProps {
  envConfig: EnvironmentConfig;
}

export class WagandaOpsStack extends Stack {
  public readonly logGroup: logs.LogGroup;
  public readonly snsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: OpsStackProps) {
    super(scope, id, props);

    const { envConfig } = props;

    // CloudWatch 로그 그룹 (14일 보관)
    this.logGroup = new logs.LogGroup(this, 'WagandaLogGroup', {
      logGroupName: `/aws/waganda/${envConfig.env}`,
      retention: logs.RetentionDays.TWO_WEEKS,
    });

    // SNS 알림 토픽
    this.snsTopic = new sns.Topic(this, 'NotificationTopic', {
      topicName: `waganda-notifications-${envConfig.resourceSuffix}`,
      displayName: `Waganda ${envConfig.env} Notifications`,
    });

    // AWS Budgets는 CDK 네이티브 구성이 제한적이므로 주석으로 구조만 표시
    // 실제 배포 시 콘솔 또는 CloudFormation 수동 추가
    // 목표:
    // - 월 $10 이상시 80% 알림
    // - 월 $10 도달 시 100% 알림
    // - 필터: Project=waganda 태그

    // CloudWatch 알람
    // 1. 에이전트 실패율
    const agentFailureAlarm = new cloudwatch.Alarm(this, 'AgentFailureRateAlarm', {
      alarmName: `waganda-agent-failure-rate-${envConfig.resourceSuffix}`,
      alarmDescription: 'Alert when agent failure rate exceeds 5%',
      metric: new cloudwatch.Metric({
        namespace: 'Waganda/Agent',
        metricName: 'FailureRate',
        statistic: cloudwatch.Stats.AVERAGE,
        period: Duration.hours(1),
        label: 'Agent Failure Rate',
      }),
      threshold: 5, // 5%
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    agentFailureAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.snsTopic));

    // 2. 평균 지연시간
    const agentLatencyAlarm = new cloudwatch.Alarm(this, 'AgentLatencyAlarm', {
      alarmName: `waganda-agent-latency-${envConfig.resourceSuffix}`,
      alarmDescription: 'Alert when agent average latency exceeds 30 seconds',
      metric: new cloudwatch.Metric({
        namespace: 'Waganda/Agent',
        metricName: 'Latency',
        statistic: cloudwatch.Stats.AVERAGE,
        period: Duration.hours(1),
        label: 'Agent Latency (sec)',
      }),
      threshold: 30000, // 30 seconds in milliseconds
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    agentLatencyAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.snsTopic));

    // 3. 스키마 검증 실패율
    const schemaValidationFailureAlarm = new cloudwatch.Alarm(this, 'SchemaValidationFailureAlarm', {
      alarmName: `waganda-schema-validation-failure-${envConfig.resourceSuffix}`,
      alarmDescription: 'Alert when schema validation failure rate exceeds 2%',
      metric: new cloudwatch.Metric({
        namespace: 'Waganda/Validation',
        metricName: 'SchemaValidationFailureRate',
        statistic: cloudwatch.Stats.AVERAGE,
        period: Duration.hours(1),
        label: 'Schema Validation Failure Rate',
      }),
      threshold: 2, // 2%
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    schemaValidationFailureAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.snsTopic));

    // 로그 그룹 권한
    this.logGroup.grantWrite(new iam.ServicePrincipal('logs.amazonaws.com'));

    // ─── GitHub Actions OIDC 배포 역할 ──────────────────────────────
    //
    // 장기 액세스 키를 저장소에 두지 않기 위해 OIDC 로 역할을 맡는다.
    //
    // 권한 범위를 좁히는 핵심: **이 역할에 배포 권한을 주지 않는다.**
    // CDK v2 는 배포 시 부트스트랩이 만든 역할(`cdk-hnb659fds-*`)을 assume 해서
    // 실제 작업을 하므로, 여기서는 그 assume 권한만 있으면 된다.
    // 나머지는 워크플로가 CDK 밖에서 직접 하는 일(이미지 푸시·정적 자산 업로드·캐시 무효화)뿐이다.
    const names = resourceNames(envConfig);

    // L1 을 쓴다 — L2 `OpenIdConnectProvider` 는 thumbprint 조회용 Lambda 커스텀 리소스를
    // 만들어 스택에 불필요한 함수가 남는다.
    const githubOidcProvider = new iam.CfnOIDCProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIdList: ['sts.amazonaws.com'],
      // GitHub 루트 CA thumbprint. IAM 은 GitHub OIDC 에 대해 실제 검증을 자체 수행하지만
      // 속성 자체는 필수다.
      thumbprintList: [
        '6938fd4d98bab03faadb97b34396831e3780aea1',
        '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
      ],
    });

    const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: `waganda-github-deploy-${envConfig.resourceSuffix}`,
      description: 'GitHub Actions OIDC deploy role',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(
        githubOidcProvider.attrArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          // 저장소와 브랜치를 못박는다. PR 이나 다른 저장소의 워크플로는 맡을 수 없다.
          // `ref:refs/heads/main` 만 허용하므로 포크 PR 로는 자격증명을 얻지 못한다.
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_REPOSITORY}:ref:refs/heads/main`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    // CDK 부트스트랩 역할 assume — 실제 CloudFormation 조작 권한은 이 역할들이 갖는다.
    deployRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${envConfig.region}`],
      }),
    );

    // ECR 로그인 토큰은 리소스를 지정할 수 없다.
    deployRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'EcrAuthToken',
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );

    // 이미지 푸시·크기 검사용 pull — 이 프로젝트의 리포 3개로 한정한다.
    deployRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'EcrPushPull',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:DescribeImages',
        ],
        resources: Object.values(names.ecr).map(
          (repo) => `arn:aws:ecr:${envConfig.region}:${this.account}:repository/${repo}`,
        ),
      }),
    );

    // Next.js 정적 자산 업로드 (`aws s3 sync`). BucketDeployment 를 쓰지 않으므로 CI 가 올린다.
    deployRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'StaticAssetsSync',
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [`arn:aws:s3:::${names.staticBucket}/*`],
      }),
    );
    deployRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'StaticAssetsList',
        actions: ['s3:ListBucket'],
        resources: [`arn:aws:s3:::${names.staticBucket}`],
      }),
    );

    // 배포 후 HTML 캐시 무효화 (공개 페이지는 기본 7일 캐시다).
    deployRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidate',
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
      }),
    );

    new CfnOutput(this, 'GitHubActionsDeployRoleArnOutput', {
      value: deployRole.roleArn,
      description: 'GitHub Secrets 의 AWS_DEPLOY_ROLE_ARN 에 등록할 값',
    });
  }
}
