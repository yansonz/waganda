/**
 * 데이터 스택 테스트 (Requirement 17.1)
 * 
 * - DynamoDB 온디맨드 모드 (PAY_PER_REQUEST)
 * - PITR 활성화
 * - GSI1 존재
 * - S3 퍼블릭 차단
 */
import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { WagandaDataStack } from '../lib/data-stack';
import { getEnvironmentConfig } from '../lib/env';
import { Tags } from 'aws-cdk-lib';

describe('Data Stack Validation', () => {
  function createDataStack(): WagandaDataStack {
    const app = new cdk.App();
    const envConfig = getEnvironmentConfig('dev');
    Tags.of(app).add('Project', 'waganda');
    Tags.of(app).add('Environment', 'dev');

    return new WagandaDataStack(app, 'DataStack', {
      stackName: 'test-data-stack',
      envConfig,
    });
  }

  it('should create DynamoDB table with on-demand billing', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('should enable PITR on DynamoDB table', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
      SSESpecification: {
        SSEEnabled: true,
      },
      StreamSpecification: cdk.assertions.Match.objectLike({
        StreamViewType: 'NEW_AND_OLD_IMAGES',
      }),
    });
  });

  it('should create GSI1 index', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
        },
      ],
    });
  });

  it('should have TTL attribute on DynamoDB table', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    });
  });

  it('should block all public access on media S3 bucket', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    template.resourcePropertiesCountIs('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    }, 2); // media and session buckets
  });

  it('should enable versioning on media S3 bucket', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    // 최소 하나의 버킷이 버전 관리 활성화되어 있어야 함
    const resources = template.toJSON().Resources;
    let hasVersionedBucket = false;

    for (const [_name, resource] of Object.entries(resources || {})) {
      const resObj = resource as Record<string, unknown>;
      const props = resObj.Properties as Record<string, unknown> | undefined;
      if ((props?.VersioningConfiguration as Record<string, unknown>)?.Status === 'Enabled') {
        hasVersionedBucket = true;
        break;
      }
    }

    expect(hasVersionedBucket).toBe(true);
  });

  it('should create 3 ECR repositories', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ECR::Repository', 3);
  });

  it('should enable image scanning on ECR repositories', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    template.resourcePropertiesCountIs('AWS::ECR::Repository', {
      ImageScanningConfiguration: {
        ScanOnPush: true,
      },
    }, 3);
  });

  it('should create SSM parameters for secrets', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    // 최소 4개의 SSM 파라미터 필요
    // (Google ID, Google Secret, JWT Key, Allowlist)
    template.resourceCountIs('AWS::SSM::Parameter', 4);
  });

  it('should use correct SSM parameter names matching lib/config.ts conventions', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    // lib/config.ts의 SSM_KEYS와 일치하는 파라미터 이름 확인:
    // - google/client-id
    // - google/client-secret
    // - auth/jwt-secret
    // - auth/editor-allowlist
    const resources = template.toJSON().Resources;
    const expectedPrefixes = [
      '/waganda/dev/google/client-id',
      '/waganda/dev/google/client-secret',
      '/waganda/dev/auth/jwt-secret',
      '/waganda/dev/auth/editor-allowlist',
    ];

    const params = Object.entries(resources || {})
      .filter(([_name, resource]: [string, unknown]) => {
        const resObj = resource as Record<string, unknown>;
        return resObj.Type === 'AWS::SSM::Parameter';
      })
      .map(([_name, resource]: [string, unknown]) => {
        const resObj = resource as Record<string, unknown>;
        const props = resObj.Properties as Record<string, unknown> | undefined;
        return props?.Name as string | undefined;
      })
      .filter(Boolean);

    for (const expected of expectedPrefixes) {
      expect(params).toContain(expected);
    }
  });
});
