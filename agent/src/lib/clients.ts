/**
 * lib/clients.ts — AWS SDK 클라이언트 lazy singleton.
 *
 * design.md 원칙 6(프레임워크 중립 계약)에 따라 그래프 노드는 이 파일이 제공하는
 * 클라이언트만 사용하고, AWS SDK를 직접 import 하지 않는다. 테스트에서는
 * `setXxxClient()` 로 스텁을 주입하고 `resetClients()` 로 되돌린다.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { TranscribeClient } from '@aws-sdk/client-transcribe';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';

let dynamoDoc: DynamoDBDocumentClient | undefined;
let s3: S3Client | undefined;
let transcribe: TranscribeClient | undefined;
let lambda: LambdaClient | undefined;
let cloudFront: CloudFrontClient | undefined;

/** 에이전트 런타임 리전 — 미설정 시 명시적으로 실패한다 (design.md '검증된 런타임 제약') */
function region(): string {
  const value = process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'];
  if (!value) {
    throw new Error('AWS_REGION 환경변수가 설정되지 않았습니다.');
  }
  return value;
}

export function getDynamoDocClient(): DynamoDBDocumentClient {
  if (dynamoDoc === undefined) {
    const base = new DynamoDBClient({ region: region() });
    dynamoDoc = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
      unmarshallOptions: { wrapNumbers: false },
    });
  }
  return dynamoDoc;
}

export function getS3Client(): S3Client {
  s3 ??= new S3Client({ region: region() });
  return s3;
}

export function getTranscribeClient(): TranscribeClient {
  transcribe ??= new TranscribeClient({ region: region() });
  return transcribe;
}

export function getLambdaClient(): LambdaClient {
  lambda ??= new LambdaClient({ region: region() });
  return lambda;
}

export function getCloudFrontClient(): CloudFrontClient {
  cloudFront ??= new CloudFrontClient({ region: region() });
  return cloudFront;
}

/* ── 테스트 전용 주입/초기화 ─────────────────────────────────────── */

export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  dynamoDoc = client;
}
export function setS3Client(client: S3Client): void {
  s3 = client;
}
export function setTranscribeClient(client: TranscribeClient): void {
  transcribe = client;
}
export function setLambdaClient(client: LambdaClient): void {
  lambda = client;
}
export function setCloudFrontClient(client: CloudFrontClient): void {
  cloudFront = client;
}

/** 테스트 전용 — 모든 스텁을 해제해 다음 접근 시 재생성하게 한다 */
export function resetClients(): void {
  dynamoDoc = undefined;
  s3 = undefined;
  transcribe = undefined;
  lambda = undefined;
  cloudFront = undefined;
}
