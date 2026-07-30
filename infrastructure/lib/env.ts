/**
 * 환경 컨텍스트 헬퍼
 * dev/prod 환경 간 설정 분기를 담당한다
 */
import { RemovalPolicy } from 'aws-cdk-lib';

export type EnvironmentName = 'dev' | 'prod';

export interface EnvironmentConfig {
  env: EnvironmentName;
  domain: string;
  resourceSuffix: string;
  removalPolicy: RemovalPolicy;
  region: string;
  account?: string;
}

export function getEnvironmentConfig(env: string): EnvironmentConfig {
  if (env !== 'dev' && env !== 'prod') {
    throw new Error(`Invalid environment: ${env}. Must be 'dev' or 'prod'.`);
  }

  const baseConfig: Record<EnvironmentName, EnvironmentConfig> = {
    dev: {
      env: 'dev',
      domain: 'waganda-dev.yanbert.com',
      resourceSuffix: 'dev',
      removalPolicy: RemovalPolicy.DESTROY, // 개발 환경에서는 삭제 가능
      region: 'ap-northeast-2', // 서울 리전
      account: undefined, // 배포 시점에 결정, 전용 계정 ID 필요
    },
    prod: {
      env: 'prod',
      domain: 'waganda.yanbert.com',
      resourceSuffix: 'prod',
      removalPolicy: RemovalPolicy.RETAIN, // 프로덕션에서는 데이터 보존
      region: 'ap-northeast-2', // 서울 리전
      account: undefined,
    },
  };

  return baseConfig[env];
}

/**
 * 리소스 물리 이름 규약.
 *
 * 스택 간에 construct 객체(토큰)를 넘기면 CloudFormation 크로스 스택 참조가 생겨
 * `DataStack ↔ WebStack` 순환 의존이 발생한다(예: WebStack 이 미디어 버킷에 OAC 정책을
 * 붙이면 정책은 버킷 소유 스택에 생성되면서 역방향 참조가 만들어진다).
 * 이름 규약을 여기서 단일 정의하고, 참조가 필요한 쪽은 `fromBucketName`·
 * `fromRepositoryName` 으로 **이름 기반 임포트**를 하여 순환을 원천 차단한다.
 */
export function resourceNames(envConfig: EnvironmentConfig) {
  const suffix = envConfig.resourceSuffix;
  return {
    table: `waganda-${suffix}`,
    mediaBucket: `waganda-media-${suffix}`,
    sessionBucket: `waganda-sessions-${suffix}`,
    staticBucket: `waganda-static-${suffix}`,
    ecr: {
      web: 'waganda-web',
      agent: 'waganda-agent',
      audio: 'waganda-audio',
    },
  } as const;
}
