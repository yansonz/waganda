/**
 * 운영 스택 (WagandaOpsStack)
 * - CloudWatch 로그 그룹 (14일 보관)
 * - AWS Budgets (Project 태그 필터)
 * - SNS 알림 토픽
 * - CloudWatch 알람 (실패율, 지연시간, 스키마 검증 실패율)
 */
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvironmentConfig } from './env';

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
  }
}
