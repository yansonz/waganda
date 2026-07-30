/**
 * lib/upload/presign.ts — 녹음 업로드용 S3 사전 서명 URL 발급.
 *
 * `app/api/tastings/[id]/recordings` 라우트에서 사용한다.
 * AWS 실호출은 주입 가능한 `Presigner` 를 통해서만 수행해 테스트에서 스텁 가능하게 한다.
 */
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getRuntimeConfig } from '@/lib/config';
import { assertExternalCallAllowed } from '@/lib/aws/testGuard';

/** 사전 서명 URL 발급 기본 만료 시간(초) */
export const PRESIGN_EXPIRES_IN_SEC = 900;

/** 실제 AWS SDK 호출을 대신하는 주입 가능한 인터페이스 — 테스트에서 스텁으로 교체한다 */
export interface RecordingPresigner {
  presignPut(params: { bucket: string; key: string; contentType: string }): Promise<string>;
}

class SdkRecordingPresigner implements RecordingPresigner {
  constructor(private readonly client: S3Client) {}

  async presignPut(params: { bucket: string; key: string; contentType: string }): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGN_EXPIRES_IN_SEC });
  }
}

let presigner: RecordingPresigner | undefined;
let s3Client: S3Client | undefined;

/** 테스트 전용 — presigner 스텁을 주입한다 */
export function setRecordingPresigner(stub: RecordingPresigner): void {
  presigner = stub;
}

/** 테스트 전용 — 주입한 스텁을 해제한다 */
export function resetRecordingPresigner(): void {
  presigner = undefined;
  s3Client = undefined;
}

function getPresigner(region: string): RecordingPresigner {
  if (presigner) return presigner;

  /*
   * `WAGANDA_S3_ENDPOINT` 가 있으면 그 엔드포인트로 서명한다 (로컬 S3 / LocalStack).
   * 없으면 실제 AWS 로 서명한다 — 프로덕션 동작에는 영향이 없다.
   *
   * 로컬에서 이 설정이 없으면 브라우저의 사전 서명 PUT 이 실제 AWS 로 나가
   * 존재하지 않는 버킷·CORS 미설정으로 실패한다.
   */
  const endpoint = process.env.WAGANDA_S3_ENDPOINT;

  // 로컬 S3 가 아니면 실제 버킷을 향한다 — 테스트에서는 스텁(setRecordingPresigner)을 써야 한다
  if (!endpoint) {
    assertExternalCallAllowed('실제 S3 사전 서명');
  }

  /*
   * 체크섬 계산을 '필요할 때만' 으로 낮춘다.
   *
   * AWS SDK v3 는 기본적으로 PutObject 에 `x-amz-checksum-crc32` 를 요구하도록 서명한다.
   * 그런데 브라우저는 사전 서명 URL 로 PUT 할 때 그 헤더를 보내지 않으므로
   * S3 가 `InvalidRequest: Value for x-amz-checksum-crc32 header is invalid` 로 거부한다.
   * 사전 서명 업로드에서는 이 기본값을 끄는 것이 정석이다.
   */
  s3Client ??= new S3Client({
    region,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: true,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
  presigner = new SdkRecordingPresigner(s3Client);
  return presigner;
}

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

/** 녹음 업로드용 S3 키를 생성한다 (media 버킷의 `recordings/` 프리픽스) */
export function buildAudioKey(tastingId: string, recordingId: string, format: string): string {
  return `recordings/${tastingId}/${recordingId}.${format}`;
}

/** 녹음 업로드용 사전 서명 URL을 발급한다 */
export async function presignRecordingUpload(input: {
  tastingId: string;
  format: string;
}): Promise<{ recordingId: string; audioKey: string; uploadUrl: string; expiresInSec: number }> {
  const config = getRuntimeConfig();
  const recordingId = randomUUID();
  const audioKey = buildAudioKey(input.tastingId, recordingId, input.format);
  const contentType = CONTENT_TYPE_BY_FORMAT[input.format] ?? 'application/octet-stream';

  const uploadUrl = await getPresigner(config.region).presignPut({
    bucket: config.mediaBucket,
    key: audioKey,
    contentType,
  });

  return { recordingId, audioKey, uploadUrl, expiresInSec: PRESIGN_EXPIRES_IN_SEC };
}

/* ── 라벨 사진 ─────────────────────────────────────────────────── */

/** 라벨 사진 허용 형식 (콘텐츠 타입 → 확장자) */
export const LABEL_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** 라벨 사진 크기 상한 (10MB) — 휴대폰 원본 사진을 감안한 값 */
export const MAX_LABEL_IMAGE_BYTES = 10 * 1024 * 1024;

/** 라벨 사진 업로드용 S3 키 (media 버킷의 `labels/` 프리픽스) */
export function buildLabelImageKey(imageId: string, extension: string): string {
  return `labels/${imageId}.${extension}`;
}

/**
 * 라벨 사진 업로드용 사전 서명 URL을 발급한다.
 *
 * 라벨 인식(`/api/labels/analyze`)은 S3 에 올라간 객체를 읽으므로
 * **실제 업로드가 선행되어야 한다**.
 */
export async function presignLabelImageUpload(input: {
  contentType: string;
}): Promise<{ imageKey: string; uploadUrl: string; expiresInSec: number }> {
  const config = getRuntimeConfig();
  const extension = LABEL_IMAGE_TYPES[input.contentType];
  if (!extension) {
    throw new Error(
      `지원하지 않는 이미지 형식입니다: ${input.contentType} (지원: ${Object.keys(LABEL_IMAGE_TYPES).join(', ')})`,
    );
  }

  const imageKey = buildLabelImageKey(randomUUID(), extension);
  const uploadUrl = await getPresigner(config.region).presignPut({
    bucket: config.mediaBucket,
    key: imageKey,
    contentType: input.contentType,
  });

  return { imageKey, uploadUrl, expiresInSec: PRESIGN_EXPIRES_IN_SEC };
}
