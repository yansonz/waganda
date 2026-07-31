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

  it('미디어 버킷은 서비스 도메인에서의 직접 업로드만 CORS 로 허용한다', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    // 브라우저가 사전 서명 URL 로 직접 PUT 하므로 CORS 가 없으면 업로드가 막힌다.
    // 오리진을 `*` 로 열면 유출된 사전 서명 URL 을 다른 사이트에서 쓸 수 있다.
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'waganda-media-dev',
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedMethods: ['PUT'],
            AllowedOrigins: ['https://waganda-dev.yanbert.com'],
          },
        ],
      },
    });
  });

  it('SecureString 시크릿은 CDK 로 만들지 않는다 — 템플릿에 SSM 파라미터가 없어야 한다', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    // CloudFormation 은 SecureString 파라미터를 만들 수 없다.
    // 시크릿은 scripts/put-secrets.sh 로 사람이 사전 생성한다.
    template.resourceCountIs('AWS::SSM::Parameter', 0);
  });

  it('SSM 파라미터 이름 규약을 lib/config.ts 와 같은 경로로 노출한다', () => {
    // 규약은 프로덕션 코드의 상수에서 가져와 단정한다(문자열을 테스트에 재작성하지 않는다).
    const names = WagandaDataStack.SSM_PARAM_NAMES;

    expect(names.googleClientId('prod')).toBe('/waganda/prod/google/client-id');
    expect(names.googleClientSecret('prod')).toBe('/waganda/prod/google/client-secret');
    expect(names.jwtSecret('prod')).toBe('/waganda/prod/auth/jwt-secret');
    expect(names.editorAllowlist('prod')).toBe('/waganda/prod/auth/editor-allowlist');
    // 선택 항목(라벨 보강용 웹 검색 키) — put-secrets.sh 의 --serpapi-key 와 같은 경로여야 한다.
    expect(names.serpApiKey('prod')).toBe('/waganda/prod/search/serpapi-key');
  });

  it('Claude 추론 프로파일 3개를 글로벌 프로파일에서 복사해 만든다', () => {
    const stack = createDataStack();
    const template = Template.fromStack(stack);

    // Bedrock 은 온디맨드 모델 ID 를 거부한다. 태그 귀속을 위해 애플리케이션 프로파일을 만든다.
    template.resourceCountIs('AWS::Bedrock::ApplicationInferenceProfile', 3);

    // 리전 경계를 넘어 라우팅하는 `global.` 프로파일에서 복사해야 스로틀링에 강하다.
    // CopyFrom 은 계정 ID 토큰이 섞인 Fn::Join 이므로 직렬화해서 확인한다.
    const profiles = template.findResources('AWS::Bedrock::ApplicationInferenceProfile');
    const serialized = Object.values(profiles).map((p) => JSON.stringify(p.Properties?.ModelSource));

    for (const source of [
      'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      'global.anthropic.claude-sonnet-5',
      'global.anthropic.claude-opus-5',
    ]) {
      expect(serialized.some((s) => s.includes(`inference-profile/${source}`))).toBe(true);
    }
  });
});
