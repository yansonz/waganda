/**
 * lib/cache/invalidate.ts — 쓰기 성공 시 CloudFront `/*` 무효화 발행 (15.3).
 *
 * design.md '캐시 및 무효화 전략': 무효화는 월 1,000경로까지 무료이고
 * 쓰기 빈도가 낮으므로 정밀한 경로 계산 대신 `/*` 단일 패턴을 쓴다.
 *
 * `distributionId` 가 설정되지 않으면(로컬·테스트 등) no-op + 로그만 남긴다 —
 * 배포 전 환경에서 무효화 실패로 쓰기 자체가 막히면 안 된다.
 */
import {
  CloudFrontClient,
  CreateInvalidationCommand,
  type CloudFrontClient as CloudFrontClientType,
} from '@aws-sdk/client-cloudfront';
import { getRuntimeConfig } from '@/lib/config';

/** 실제 AWS SDK 호출을 대신하는 주입 가능한 인터페이스 — 테스트에서 스텁으로 교체한다 */
export interface CloudFrontInvalidator {
  createInvalidation(params: {
    distributionId: string;
    paths: string[];
  }): Promise<{ invalidationId?: string }>;
}

class SdkCloudFrontInvalidator implements CloudFrontInvalidator {
  constructor(private readonly client: CloudFrontClientType) {}

  async createInvalidation(params: {
    distributionId: string;
    paths: string[];
  }): Promise<{ invalidationId?: string }> {
    const result = await this.client.send(
      new CreateInvalidationCommand({
        DistributionId: params.distributionId,
        InvalidationBatch: {
          CallerReference: `waganda-${Date.now()}`,
          Paths: { Quantity: params.paths.length, Items: params.paths },
        },
      }),
    );
    return { invalidationId: result.Invalidation?.Id };
  }
}

let invalidator: CloudFrontInvalidator | undefined;
let cfClient: CloudFrontClientType | undefined;

/** 테스트 전용 — invalidator 스텁을 주입한다 */
export function setCloudFrontInvalidator(stub: CloudFrontInvalidator): void {
  invalidator = stub;
}

/** 테스트 전용 — 주입한 스텁을 해제하고 다음 호출 시 실제 구현을 재생성하게 한다 */
export function resetCloudFrontInvalidator(): void {
  invalidator = undefined;
  cfClient = undefined;
}

function getInvalidator(region: string): CloudFrontInvalidator {
  if (invalidator) return invalidator;
  cfClient ??= new CloudFrontClient({ region });
  invalidator = new SdkCloudFrontInvalidator(cfClient);
  return invalidator;
}

export interface InvalidateCacheResult {
  /** 실제로 무효화를 발행했는지 — distributionId 미설정 시 false (no-op) */
  invalidated: boolean;
  invalidationId?: string;
}

/**
 * 쓰기 성공 시 호출한다. `/*` 단일 패턴으로 전체 캐시를 무효화한다.
 * `WAGANDA_CF_DISTRIBUTION_ID` 가 없으면 no-op 으로 처리하고 로그만 남긴다.
 */
export async function invalidateCache(): Promise<InvalidateCacheResult> {
  const config = getRuntimeConfig();

  if (!config.cloudFrontDistributionId) {
    console.log('[lib/cache/invalidate] distributionId 미설정 — 무효화를 건너뜁니다 (no-op).');
    return { invalidated: false };
  }

  const result = await getInvalidator(config.region).createInvalidation({
    distributionId: config.cloudFrontDistributionId,
    paths: ['/*'],
  });

  return { invalidated: true, invalidationId: result.invalidationId };
}
