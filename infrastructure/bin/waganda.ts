#!/usr/bin/env node

/**
 * 와간다 (Waganda) CDK 앱
 * 
 * 개발/프로덕션 환경을 컨텍스트에서 받아 4개 스택을 인스턴스화한다
 * 태깅: Project=waganda, Environment=dev/prod
 */
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { getEnvironmentConfig } from '../lib/env';
import { WagandaDataStack } from '../lib/data-stack';
import { WagandaPipelineStack } from '../lib/pipeline-stack';
import { WagandaWebStack } from '../lib/web-stack';
import { WagandaOpsStack } from '../lib/ops-stack';

const app = new cdk.App();

// 환경 컨텍스트 읽기 (기본값 'prod' — 이 프로젝트는 prod 환경만 배포한다)
const envName = app.node.tryGetContext('env') || 'prod';

if (envName !== 'dev' && envName !== 'prod') {
  throw new Error(`Invalid environment context: ${envName}. Must be 'dev' or 'prod'.`);
}

const envConfig = getEnvironmentConfig(envName);

// 배포 대상 계정·리전을 명시한다.
// 환경 비특정(env-agnostic) 스택으로 두면 CLI 프로필의 리전에 따라 배포 위치가 달라지므로,
// 리전은 envConfig(ap-northeast-2)로 고정하고 계정만 CLI 컨텍스트에서 받는다.
const stackEnv: cdk.Environment = {
  account: envConfig.account ?? process.env.CDK_DEFAULT_ACCOUNT,
  region: envConfig.region,
};

// 앱 수준 태깅
Tags.of(app).add('Project', 'waganda');
Tags.of(app).add('Environment', envConfig.env);

// 컨텍스트 값은 빈 문자열이 주어질 수 있다(cdk.json 기본값·CI 변수 미설정).
// 빈 값은 undefined 로 정규화해 CloudFormation 에 빈 문자열이 흘러가지 않게 한다.
const ctx = (key: string): string | undefined => {
  const val = app.node.tryGetContext(key);
  return typeof val === 'string' && val.trim() !== '' ? val.trim() : undefined;
};

// 스택 생성
const dataStack = new WagandaDataStack(app, 'WagandaDataStack', {
  stackName: `waganda-data-${envConfig.resourceSuffix}`,
  description: `Waganda data stack (${envConfig.env})`,
  env: stackEnv,
  envConfig,
});

const pipelineStack = new WagandaPipelineStack(app, 'WagandaPipelineStack', {
  stackName: `waganda-pipeline-${envConfig.resourceSuffix}`,
  description: `Waganda pipeline stack (${envConfig.env})`,
  env: stackEnv,
  envConfig,
  dataStack,
  // 에이전트 런타임 환경변수로 넘길 값들 — WebStack 소유 리소스와 사람이 만드는 추론 프로파일.
  cloudFrontDistributionId: ctx('cloudFrontDistributionId'),
  bedrockModelProfileArn: ctx('bedrockModelProfileArn'),
});

const webStack = new WagandaWebStack(app, 'WagandaWebStack', {
  stackName: `waganda-web-${envConfig.resourceSuffix}`,
  description: `Waganda web stack (${envConfig.env})`,
  env: stackEnv,
  envConfig,
  // 계정·인증서 없이도 synth 가 성공해야 하고, DataStack construct 를 직접 넘기면
  // OAC 정책 때문에 순환 의존이 생기므로 전부 컨텍스트로 받는다.
  hostedZoneId: ctx('hostedZoneId'),
  certificateArn: ctx('certificateArn'),
  cloudFrontDistributionId: ctx('cloudFrontDistributionId'),
  agentRuntimeArn: ctx('agentRuntimeArn'),
  bedrockModelProfileArn: ctx('bedrockModelProfileArn'),
});

// 스택 순서를 명시한다(물리 참조는 이름 기반이라 CDK 가 자동 추론하지 못한다).
webStack.addDependency(dataStack);
pipelineStack.addDependency(dataStack);

const _opsStack = new WagandaOpsStack(app, 'WagandaOpsStack', {
  stackName: `waganda-ops-${envConfig.resourceSuffix}`,
  description: `Waganda ops stack (${envConfig.env})`,
  env: stackEnv,
  envConfig,
});

app.synth();
