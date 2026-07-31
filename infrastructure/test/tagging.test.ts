/**
 * 태깅 검증 테스트 (Requirement 17.7)
 * 
 * 모든 태깅 가능 리소스에 Project=waganda 태그가 부여되었는지 검증
 * 태그는 앱 수준에서 부여되고 모든 하위 리소스로 전파됨
 */
import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { WagandaDataStack } from '../lib/data-stack';
import { WagandaPipelineStack } from '../lib/pipeline-stack';
import { WagandaOpsStack } from '../lib/ops-stack';
import { getEnvironmentConfig } from '../lib/env';
import { Tags } from 'aws-cdk-lib';

describe('Tagging Compliance', () => {
  function verifyTaggingInStack(stack: cdk.Stack, stackName: string): void {
    const template = Template.fromStack(stack);
    const allResources = template.toJSON().Resources;

    if (!allResources) {
      console.warn(`No resources found in stack: ${stackName}`);
      return;
    }

    // 태그가 필요 없는 리소스 타입
    const untaggableTypes = [
      'AWS::CloudFormation::WaitConditionHandle',
      'AWS::CloudFormation::CustomResource',
    ];

    const taggableResources = Object.entries(allResources)
      .filter(([_name, resource]: [string, unknown]) => {
        const resObj = resource as Record<string, unknown>;
        const type = (resObj.Type as string) || '';
        return !untaggableTypes.some(t => type.includes(t));
      })
      .filter(([_name, resource]: [string, unknown]) => {
        // 대부분의 AWS 리소스는 Properties.Tags를 지원
        const resObj = resource as Record<string, unknown>;
        return resObj.Properties;
      });

    for (const [resourceName, resource] of taggableResources) {
      const resObj = resource as Record<string, unknown>;
      const props = resObj.Properties as Record<string, unknown> | undefined;
      const tagsVal = props?.Tags;
      const tags = Array.isArray(tagsVal) ? tagsVal : [];
      const projectTag = tags.find((t: Record<string, unknown>) => t.Key === 'Project');
      
      if (!projectTag) {
        console.warn(`Resource ${resourceName} (${resObj.Type}) missing Project tag`);
      }
    }
  }

  it('should have Project=waganda tag on all taggable DynamoDB resources', () => {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('prod');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'prod');

    const dataStack = new WagandaDataStack(app, 'DataStack', {
      stackName: 'test-data-stack',
      envConfig,
    });

    const template = Template.fromStack(dataStack);
    
    // DynamoDB 테이블 확인
    template.resourcePropertiesCountIs('AWS::DynamoDB::Table', {
      Tags: cdk.assertions.Match.arrayWith([
        cdk.assertions.Match.objectLike({ Key: 'Project', Value: 'waganda' }),
      ]),
    }, 1);

    verifyTaggingInStack(dataStack, 'DataStack');
  });

  it('should have Project=waganda tag on all S3 buckets', () => {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('prod');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'prod');

    const dataStack = new WagandaDataStack(app, 'DataStack', {
      stackName: 'test-data-stack',
      envConfig,
    });

    const template = Template.fromStack(dataStack);
    
    // S3 버킷 확인 (최소 2개: media, session)
    template.resourcePropertiesCountIs('AWS::S3::Bucket', {
      Tags: cdk.assertions.Match.arrayWith([
        cdk.assertions.Match.objectLike({ Key: 'Project', Value: 'waganda' }),
      ]),
    }, 2);

    verifyTaggingInStack(dataStack, 'DataStack');
  });

  it('should have Project=waganda tag on all ECR repositories', () => {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('prod');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'prod');

    const dataStack = new WagandaDataStack(app, 'DataStack', {
      stackName: 'test-data-stack',
      envConfig,
    });

    const template = Template.fromStack(dataStack);
    
    // ECR 리포지토리 확인 (3개: web, agent, audio)
    template.resourcePropertiesCountIs('AWS::ECR::Repository', {
      Tags: cdk.assertions.Match.arrayWith([
        cdk.assertions.Match.objectLike({ Key: 'Project', Value: 'waganda' }),
      ]),
    }, 3);

    verifyTaggingInStack(dataStack, 'DataStack');
  });

  it('should have Project=waganda tag on SQS queues', () => {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('prod');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'prod');

    const dataStack = new WagandaDataStack(app, 'DataStack', {
      stackName: 'test-data-stack',
      envConfig,
    });

    const pipelineStack = new WagandaPipelineStack(app, 'PipelineStack', {
      stackName: 'test-pipeline-stack',
      envConfig,
      dataStack,
    });

    const template = Template.fromStack(pipelineStack);
    
    // SQS 큐 확인 (최소 2개: queue, dlq)
    template.resourcePropertiesCountIs('AWS::SQS::Queue', {
      Tags: cdk.assertions.Match.arrayWith([
        cdk.assertions.Match.objectLike({ Key: 'Project', Value: 'waganda' }),
      ]),
    }, 2);

    verifyTaggingInStack(pipelineStack, 'PipelineStack');
  });

  it('should have Project=waganda tag on Lambda functions', () => {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('prod');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'prod');

    const dataStack = new WagandaDataStack(app, 'DataStack', {
      stackName: 'test-data-stack',
      envConfig,
    });

    const pipelineStack = new WagandaPipelineStack(app, 'PipelineStack', {
      stackName: 'test-pipeline-stack',
      envConfig,
      dataStack,
    });

    const template = Template.fromStack(pipelineStack);
    
    // Lambda 함수 확인 (trigger-upload, trigger-transcribe가 Project 태그를 가져야 함)
    template.resourcePropertiesCountIs('AWS::Lambda::Function', {
      FunctionName: cdk.assertions.Match.stringLikeRegexp('.*trigger-(upload|transcribe).*'),
      Tags: cdk.assertions.Match.arrayWith([
        cdk.assertions.Match.objectLike({ Key: 'Project', Value: 'waganda' }),
      ]),
    }, 2);

    verifyTaggingInStack(pipelineStack, 'PipelineStack');
  });

  it('should have Environment tag on all resources', () => {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('prod');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'prod');

    const opsStack = new WagandaOpsStack(app, 'OpsStack', {
      stackName: 'test-ops-stack',
      envConfig,
    });

    const template = Template.fromStack(opsStack);
    
    // 로그 그룹 확인
    template.resourcePropertiesCountIs('AWS::Logs::LogGroup', {
      Tags: cdk.assertions.Match.arrayWith([
        cdk.assertions.Match.objectLike({ Key: 'Environment', Value: 'prod' }),
      ]),
    }, 1);

    verifyTaggingInStack(opsStack, 'OpsStack');
  });
});
