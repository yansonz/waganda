/**
 * 상시 과금 리소스 부재 검증 (tasks 17.6, requirements R11).
 *
 * 유휴 시 과금되는 리소스를 하나도 두지 않는다는 것이 이 프로젝트의 명시적 요구다.
 * 합성 산출물에서 해당 리소스 타입이 **전혀 등장하지 않음**을 단정한다.
 */
import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { getEnvironmentConfig } from '../lib/env';
import { WagandaDataStack } from '../lib/data-stack';
import { WagandaPipelineStack } from '../lib/pipeline-stack';
import { WagandaWebStack } from '../lib/web-stack';
import { WagandaOpsStack } from '../lib/ops-stack';

/** 유휴 상태에서도 시간당 과금되는 리소스 타입 */
const ALWAYS_ON_RESOURCE_TYPES = [
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::ElasticLoadBalancingV2::TargetGroup',
  'AWS::ElasticLoadBalancing::LoadBalancer',
  'AWS::EC2::NatGateway',
  'AWS::EC2::Instance',
  'AWS::EC2::EIP',
  'AWS::RDS::DBInstance',
  'AWS::RDS::DBCluster',
  'AWS::ECS::Service',
  'AWS::ECS::Cluster',
  'AWS::EKS::Cluster',
  'AWS::Redshift::Cluster',
  'AWS::SageMaker::NotebookInstance',
  'AWS::SageMaker::Endpoint',
  'AWS::ElastiCache::CacheCluster',
  'AWS::OpenSearchService::Domain',
  'AWS::MSK::Cluster',
  'AWS::DocDB::DBCluster',
  'AWS::Transfer::Server',
  'AWS::GlobalAccelerator::Accelerator',
];

function synthesizeAllTemplates(env: 'dev' | 'prod'): Array<{ name: string; template: Template }> {
  const app = new cdk.App({ context: { env } });
  const envConfig = getEnvironmentConfig(env);

  const dataStack = new WagandaDataStack(app, 'WagandaDataStack', { envConfig });
  const pipelineStack = new WagandaPipelineStack(app, 'WagandaPipelineStack', {
    envConfig,
    dataStack,
  });
  const webStack = new WagandaWebStack(app, 'WagandaWebStack', { envConfig });
  const opsStack = new WagandaOpsStack(app, 'WagandaOpsStack', { envConfig });

  return [
    { name: 'data', template: Template.fromStack(dataStack) },
    { name: 'pipeline', template: Template.fromStack(pipelineStack) },
    { name: 'web', template: Template.fromStack(webStack) },
    { name: 'ops', template: Template.fromStack(opsStack) },
  ];
}

describe('상시 과금 리소스 부재 (R11 / tasks 17.6)', () => {
  for (const env of ['dev', 'prod'] as const) {
    describe(`${env} 환경`, () => {
      const templates = synthesizeAllTemplates(env);

      for (const resourceType of ALWAYS_ON_RESOURCE_TYPES) {
        it(`${resourceType} 이 어떤 스택에도 없다`, () => {
          for (const { name, template } of templates) {
            const found = template.findResources(resourceType);
            expect(
              Object.keys(found),
              `${name} 스택에 ${resourceType} 가 존재한다`,
            ).toHaveLength(0);
          }
        });
      }

      it('DynamoDB 는 온디맨드(PAY_PER_REQUEST) 로만 구성된다 — 프로비저닝 용량 금지', () => {
        const dataTemplate = templates.find((t) => t.name === 'data')!.template;
        const tables = dataTemplate.findResources('AWS::DynamoDB::Table');
        expect(Object.keys(tables).length).toBeGreaterThan(0);
        for (const table of Object.values(tables)) {
          expect(table.Properties?.BillingMode).toBe('PAY_PER_REQUEST');
          expect(table.Properties?.ProvisionedThroughput).toBeUndefined();
        }
      });

      it('VPC 를 만들지 않는다 — 사설 네트워크 부속 비용이 발생하지 않는다', () => {
        for (const { name, template } of templates) {
          expect(
            Object.keys(template.findResources('AWS::EC2::VPC')),
            `${name} 스택에 VPC 가 존재한다`,
          ).toHaveLength(0);
        }
      });

      it('Lambda 에 프로비저닝된 동시성이 설정되어 있지 않다', () => {
        for (const { name, template } of templates) {
          const versions = template.findResources('AWS::Lambda::Version');
          for (const version of Object.values(versions)) {
            expect(
              version.Properties?.ProvisionedConcurrencyConfig,
              `${name} 스택 Lambda 에 프로비저닝 동시성이 있다`,
            ).toBeUndefined();
          }
        }
      });
    });
  }
});
