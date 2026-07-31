/**
 * 환경 컨텍스트 헬퍼
 *
 * 이 프로젝트는 **prod 하나만 배포한다.** dev 환경은 존재하지 않는다 —
 * 개인 프로젝트이고 상시 과금 리소스를 두지 않기로 했으므로, 검증은 로컬
 * (에뮬레이터 + 실제 Bedrock/Transcribe)에서 하고 배포 대상은 prod 뿐이다.
 * `EnvironmentName` 을 넓히지 말 것.
 */
import { RemovalPolicy } from 'aws-cdk-lib';

export type EnvironmentName = 'prod';

export interface EnvironmentConfig {
  env: EnvironmentName;
  domain: string;
  resourceSuffix: string;
  removalPolicy: RemovalPolicy;
  region: string;
  account?: string;
}

export function getEnvironmentConfig(env: string): EnvironmentConfig {
  if (env !== 'prod') {
    throw new Error(`Invalid environment: ${env}. 이 프로젝트는 'prod' 만 배포한다.`);
  }

  return {
    env: 'prod',
    domain: 'waganda.yanbert.com',
    resourceSuffix: 'prod',
    removalPolicy: RemovalPolicy.RETAIN, // 프로덕션에서는 데이터 보존
    region: 'ap-northeast-2', // 서울 리전
    account: undefined, // 배포 시점에 CLI 컨텍스트에서 결정
  };
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
