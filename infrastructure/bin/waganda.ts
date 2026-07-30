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

// 환경 컨텍스트 읽기 (기본값 'dev')
const envName = app.node.tryGetContext('env') || 'dev';

if (envName !== 'dev' && envName !== 'prod') {
  throw new Error(`Invalid environment context: ${envName}. Must be 'dev' or 'prod'.`);
}

const envConfig = getEnvironmentConfig(envName);

// 앱 수준 태깅
Tags.of(app).add('Project', 'waganda');
Tags.of(app).add('Environment', envConfig.env);

// 스택 생성
const dataStack = new WagandaDataStack(app, 'WagandaDataStack', {
  stackName: `waganda-data-${envConfig.resourceSuffix}`,
  description: `Waganda data stack (${envConfig.env})`,
  envConfig,
});

const pipelineStack = new WagandaPipelineStack(app, 'WagandaPipelineStack', {
  stackName: `waganda-pipeline-${envConfig.resourceSuffix}`,
  description: `Waganda pipeline stack (${envConfig.env})`,
  envConfig,
  dataStack,
});

const webStack = new WagandaWebStack(app, 'WagandaWebStack', {
  stackName: `waganda-web-${envConfig.resourceSuffix}`,
  description: `Waganda web stack (${envConfig.env})`,
  envConfig,
  // 컨텍스트로 받는다 — 계정·인증서 없이도 synth 가 성공해야 하고,
  // DataStack construct 를 직접 넘기면 OAC 정책 때문에 순환 의존이 생긴다.
  hostedZoneId: app.node.tryGetContext('hostedZoneId'),
  certificateArn: app.node.tryGetContext('certificateArn'),
});

// 스택 순서를 명시한다(물리 참조는 이름 기반이라 CDK 가 자동 추론하지 못한다).
webStack.addDependency(dataStack);
pipelineStack.addDependency(dataStack);

const _opsStack = new WagandaOpsStack(app, 'WagandaOpsStack', {
  stackName: `waganda-ops-${envConfig.resourceSuffix}`,
  description: `Waganda ops stack (${envConfig.env})`,
  envConfig,
});

app.synth();
