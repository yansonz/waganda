/**
 * 로컬 S3 (LocalStack) 기동·버킷 준비 스크립트.
 *
 * 라벨 사진과 녹음은 브라우저가 **사전 서명 URL 로 직접 PUT** 한다.
 * 로컬에 S3 가 없으면 그 PUT 이 실제 AWS 로 나가 CORS·인증 오류로 실패한다
 * (증상: "네트워크 오류로 사진을 처리하지 못했습니다").
 *
 * 사용:
 *   npx tsx scripts/local-s3.ts up      # 기동 + 버킷 + CORS
 *   npx tsx scripts/local-s3.ts down
 */
import { execFileSync } from 'node:child_process';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export const CONTAINER_NAME = 'waganda-local-s3';
/** 다른 프로젝트의 LocalStack(4566)과 겹치지 않게 4570 을 쓴다 */
export const S3_PORT = Number(process.env.WAGANDA_S3_PORT ?? 4570);
export const S3_ENDPOINT = `http://127.0.0.1:${S3_PORT}`;
export const BUCKET = process.env.WAGANDA_MEDIA_BUCKET ?? 'waganda-media-local';

/** 브라우저가 PUT 할 수 있도록 허용할 로컬 오리진 */
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3100',
  'http://127.0.0.1:3100',
];

function docker(args: string[], quiet = true): string {
  return (
    execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: quiet ? ['ignore', 'pipe', 'ignore'] : 'inherit',
    })?.trim?.() ?? ''
  );
}

function isRunning(): boolean {
  try {
    return (
      docker(['ps', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}']) ===
      CONTAINER_NAME
    );
  } catch {
    return false;
  }
}

function startContainer(): void {
  if (isRunning()) {
    console.log(`[local-s3] 컨테이너(${CONTAINER_NAME}) 재사용`);
    return;
  }
  try {
    docker(['rm', '-f', CONTAINER_NAME]);
  } catch {
    // 없으면 무시
  }
  console.log(`[local-s3] LocalStack S3 기동 (포트 ${S3_PORT})...`);
  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER_NAME,
    '-p',
    `${S3_PORT}:4566`,
    '-e',
    'SERVICES=s3',
    'localstack/localstack:3',
  ]);
}

function client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? 'ap-northeast-2',
    endpoint: S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
}

async function waitForS3(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${S3_ENDPOINT}/_localstack/health`);
      if (res.ok) {
        console.log('[local-s3] 준비 완료');
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`[local-s3] 준비 대기 시간 초과: ${String(lastError)}`);
}

async function ensureBucket(): Promise<void> {
  const s3 = client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`[local-s3] 버킷 ${BUCKET} 재사용`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`[local-s3] 버킷 ${BUCKET} 생성`);
  }

  // 브라우저에서 사전 서명 PUT 을 하려면 CORS 가 필요하다
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedOrigins: ALLOWED_ORIGINS,
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );
  console.log('[local-s3] CORS 설정 완료');
}

export async function ensureLocalS3(): Promise<void> {
  startContainer();
  await waitForS3();
  await ensureBucket();
}

export function stopContainer(): void {
  try {
    docker(['rm', '-f', CONTAINER_NAME]);
    console.log(`[local-s3] 컨테이너(${CONTAINER_NAME}) 정리`);
  } catch {
    // 없으면 무시
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  if (command === 'up') await ensureLocalS3();
  else if (command === 'down') stopContainer();
  else throw new Error(`알 수 없는 명령: ${command} (up | down)`);
}

if (process.argv[1]?.includes('local-s3')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
