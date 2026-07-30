/**
 * GitHub Actions OIDC 배포 역할 단정.
 *
 * 이 역할은 저장소 밖에서 AWS 자격증명을 얻는 유일한 경로다.
 * 신뢰 경계가 느슨해지면(다른 저장소·브랜치·PR 허용) 포크 PR 로 프로덕션 계정을 만질 수 있다.
 * 그래서 신뢰 조건과 권한 범위를 테스트로 고정한다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { WagandaOpsStack } from '../lib/ops-stack';
import { getEnvironmentConfig, resourceNames } from '../lib/env';

describe('GitHub Actions OIDC 배포 역할', () => {
  let template: Template;
  const envConfig = getEnvironmentConfig('prod');

  beforeAll(() => {
    const app = new cdk.App({ context: { env: 'prod' } });
    const stack = new WagandaOpsStack(app, 'OpsStack', {
      env: { account: '123456789012', region: envConfig.region },
      envConfig,
    });
    template = Template.fromStack(stack);
  });

  it('GitHub OIDC 공급자를 audience sts.amazonaws.com 으로 등록한다', () => {
    template.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it('신뢰 정책이 yansonz/waganda 의 main 브랜치로 제한된다', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              },
              // 저장소·브랜치가 모두 박혀 있어야 한다.
              // `repo:*` 나 `ref:refs/pull/*` 로 넓히면 포크 PR 이 자격증명을 얻는다.
              StringLike: {
                'token.actions.githubusercontent.com:sub':
                  'repo:yansonz/waganda:ref:refs/heads/main',
              },
            },
          }),
        ]),
      }),
    });
  });

  it('역할에 직접적인 배포 권한을 주지 않고 CDK 부트스트랩 역할 assume 만 허용한다', () => {
    // CDK v2 는 부트스트랩 역할을 assume 해 실제 작업을 한다.
    // 이 역할이 CloudFormation·IAM 을 직접 조작할 수 있으면 최소 권한이 무너진다.
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AssumeCdkBootstrapRoles',
            Action: 'sts:AssumeRole',
            Resource: Match.stringLikeRegexp('role/cdk-hnb659fds-'),
          }),
        ]),
      }),
    });

    // 광범위 권한이 섞여 들어가지 않았는지 확인한다.
    const policies = template.findResources('AWS::IAM::Policy');
    const serialized = JSON.stringify(policies);
    expect(serialized).not.toContain('"cloudformation:*"');
    expect(serialized).not.toContain('"iam:*"');
    expect(serialized).not.toContain('"Action":"*"');
  });

  it('이미지 푸시 권한은 이 프로젝트의 ECR 리포로 한정된다', () => {
    const names = resourceNames(envConfig);
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));

    for (const repo of Object.values(names.ecr)) {
      expect(policies).toContain(`repository/${repo}`);
    }
    // 리포 전체를 허용하는 와일드카드가 없어야 한다.
    expect(policies).not.toContain('repository/*');
  });

  it('정적 자산 업로드는 정적 버킷으로만 제한된다', () => {
    const names = resourceNames(envConfig);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'StaticAssetsSync',
            Resource: `arn:aws:s3:::${names.staticBucket}/*`,
          }),
        ]),
      }),
    });
  });
});
