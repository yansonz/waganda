/**
 * 웹 스택 검증 (tasks 15.1, 15.2, 17.1, 17.2).
 *
 * - 경로별 캐시 정책 분리 (`/_next/static/*`, `/media/*`, 공개 페이지, `/api/*`·`/record`)
 * - S3 직접 접근 차단 (OAC)
 * - CloudFront 기본 오리진이 **플레이스홀더가 아니라 Lambda Function URL** 인지
 */
import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { getEnvironmentConfig, resourceNames } from '../lib/env';
import { WagandaWebStack } from '../lib/web-stack';

function synthWeb(certificateArn?: string): { template: Template; json: string } {
  const app = new cdk.App({ context: { env: 'prod' } });
  const envConfig = getEnvironmentConfig('prod');
  const stack = new WagandaWebStack(app, 'WagandaWebStack', { envConfig, certificateArn });
  const template = Template.fromStack(stack);
  return { template, json: JSON.stringify(template.toJSON()) };
}

describe('WagandaWebStack', () => {
  const { template, json } = synthWeb();

  it('CloudFront 배포가 하나 생성된다', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('오리진에 example.com 플레이스홀더가 남아 있지 않다', () => {
    expect(json).not.toContain('example.com');
  });

  it('기본 동작 오리진이 Lambda Function URL 을 가리킨다', () => {
    const distributions = template.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(distributions)[0].Properties.DistributionConfig;
    const defaultTargetId = config.DefaultCacheBehavior.TargetOriginId;
    const origins = config.Origins as Array<Record<string, unknown>>;
    const defaultOrigin = origins.find((o) => o.Id === defaultTargetId);

    expect(defaultOrigin).toBeDefined();
    // Function URL 은 `https://<id>.lambda-url.<region>.on.aws/` 형태이므로
    // 도메인 이름이 Fn::Select/Fn::Split 로 FunctionUrl 속성에서 파생된다.
    expect(JSON.stringify(defaultOrigin)).toContain('FunctionUrl');
  });

  it('Function URL 은 AWS_IAM 인증이며 퍼블릭이 아니다', () => {
    template.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'AWS_IAM',
    });
  });

  it('Lambda 오리진에 OAC 가 연결된다 (CloudFront 서명 호출)', () => {
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 'lambda',
        SigningBehavior: 'always',
      }),
    });
  });

  it('S3 오리진용 OAC 가 생성된다', () => {
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
      }),
    });
  });

  it('정적 자산 버킷은 퍼블릭 접근이 전면 차단된다', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: resourceNames(getEnvironmentConfig('prod')).staticBucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('정적 자산 버킷 정책은 이 배포의 실제 ARN 으로 제한된다 (와일드카드 금지)', () => {
    const policies = template.findResources('AWS::S3::BucketPolicy');
    const policyJson = JSON.stringify(Object.values(policies));
    expect(policyJson).toContain('cloudfront.amazonaws.com');
    // `distribution/*` 와일드카드가 아니라 배포 ID 참조여야 한다
    expect(policyJson).not.toContain('distribution/*');
    expect(policyJson).toContain('AWS:SourceArn');
  });

  it('/api/* 와 /record 는 캐시하지 않는다', () => {
    const distributions = template.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(distributions)[0].Properties.DistributionConfig;
    const behaviors = config.CacheBehaviors as Array<Record<string, unknown>>;

    const cachingDisabledId = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'; // 관리형 CachingDisabled
    for (const path of ['/api/*', '/record']) {
      const behavior = behaviors.find((b) => b.PathPattern === path);
      expect(behavior, `${path} 동작이 없다`).toBeDefined();
      expect(behavior?.CachePolicyId).toBe(cachingDisabledId);
    }
  });

  it('/_next/static/* 는 1년 immutable 캐시 정책을 쓴다', () => {
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        DefaultTTL: 31536000,
        MaxTTL: 31536000,
      }),
    });
  });

  it('/media/* 는 장기 캐시 정책을 쓴다', () => {
    const policies = template.findResources('AWS::CloudFront::CachePolicy');
    const mediaPolicy = Object.values(policies).find((p) =>
      String(p.Properties?.CachePolicyConfig?.Name ?? '').includes('media'),
    );
    expect(mediaPolicy).toBeDefined();
    expect(mediaPolicy?.Properties.CachePolicyConfig.DefaultTTL).toBeGreaterThanOrEqual(86400);
  });

  it('공개 페이지 캐시 정책이 분리되어 존재한다', () => {
    const policies = template.findResources('AWS::CloudFront::CachePolicy');
    const names = Object.values(policies).map((p) =>
      String(p.Properties?.CachePolicyConfig?.Name ?? ''),
    );
    expect(names.some((n) => n.includes('public'))).toBe(true);
    // 4개 경로군을 위한 정책이 최소 3개(정적/미디어/공개) 정의된다
    expect(Object.keys(policies).length).toBeGreaterThanOrEqual(3);
  });

  it('Next.js Lambda 는 ARM64 컨테이너다', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Architectures: ['arm64'],
      PackageType: 'Image',
    });
  });

  it('인증서 ARN 이 없으면 사용자 지정 도메인 없이 합성된다 (계정 없이 synth 가능)', () => {
    const distributions = template.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(distributions)[0].Properties.DistributionConfig;
    expect(config.Aliases).toBeUndefined();
  });

  it('인증서 ARN 이 주어지면 도메인 별칭이 설정된다', () => {
    const { template: withCert } = synthWeb(
      'arn:aws:acm:us-east-1:123456789012:certificate/abc-123',
    );
    withCert.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['waganda.yanbert.com'],
      }),
    });
  });

  it('웹 Lambda 는 Bedrock 추론 프로파일을 호출할 수 있다', () => {
    // lib/agent/labelDirect.ts 등이 웹 프로세스에서 직접 Converse 를 부른다.
    // 권한이 없으면 라벨 인식 폴백·소믈리에 분석이 AccessDenied 로 죽는다.
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'BedrockInference',
            // Strands SDK 는 스트리밍으로 모델을 호출한다. 스트리밍 액션이 없으면
            // 라벨 인식·소믈리에 분석이 AccessDenied 로 실패한다.
            Action: Match.arrayWith([
              'bedrock:InvokeModel',
              'bedrock:InvokeModelWithResponseStream',
            ]),
          }),
        ]),
      }),
    });
  });

  it('CloudFront 가 Function URL 을 호출할 권한이 두 액션 모두 부여된다', () => {
    // 2025-10 이후 Function URL 은 InvokeFunctionUrl 과 InvokeFunction 을 모두 요구한다.
    // 하나만 있으면 CloudFront 경유 요청이 전부 403 이 된다.
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunctionUrl',
      Principal: 'cloudfront.amazonaws.com',
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'cloudfront.amazonaws.com',
    });
  });
  it('공개 페이지 캐시 키가 RSC 요청을 구분한다', () => {
    // App Router 의 soft navigation 은 같은 경로에 `RSC: 1` 헤더와 `?_rsc=` 쿼리를 붙여
    // RSC payload 를 요청한다. 캐시 키가 이를 구분하지 않으면 캐시된 HTML 이 반환되어
    // 클라이언트가 응답을 해석하지 못하고 빈 화면이 된다(실제로 겪었다).
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        Name: 'waganda-public-prod',
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          QueryStringsConfig: { QueryStringBehavior: 'all' },
          HeadersConfig: Match.objectLike({
            HeaderBehavior: 'whitelist',
            Headers: Match.arrayWith(['RSC']),
          }),
        }),
      }),
    });
  });
});
