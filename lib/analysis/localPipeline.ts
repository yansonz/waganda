/**
 * lib/analysis/localPipeline.ts — 로컬 분석 파이프라인.
 *
 * AgentCore·SQS·EventBridge·오디오 Lambda 가 배포되지 않은 로컬에서
 * **실제 녹음으로** 분석 흐름을 끝까지 돌려 보기 위한 스크립트다.
 * 배포판의 파이프라인(세션 A/B)과 같은 순서를 따르고 같은 레코드를 남긴다.
 *
 *   1. 작업 레코드 준비 (멱등)
 *   2. 음향 특징 추출 — 로컬 Python venv 로 직접 (`audio/` 의 함수 재사용)
 *   3. 트랜스크립션 — 실제 Amazon Transcribe (ko-KR, 화자분리 2명)
 *   4. 화자 매핑 — lib/domain/speaker (F0 상대 비교)
 *   5. 소믈리에 분석 — Bedrock 직접 호출
 *   6. 결과 저장 + 작업 완료
 *
 * 두 경로에서 쓴다.
 *   1. CLI — `npm run analyze:local -- <tastingId>` (scripts/analyze-local.ts)
 *   2. 로컬 자동 실행 — 녹음 저장 직후 `POST /api/tastings/[id]/analyze` 가 호출
 *
 * 주의: 트랜스크립션·분석은 실제 AWS 를 호출하므로 소액 과금이 발생한다.
 * 배포 환경에서는 이 경로를 쓰지 않는다(AgentCore 파이프라인이 담당).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import {
  Acoustic,
  CURRENT_SCHEMA_VERSION,
  type Analysis,
  type Job,
  type Recording,
} from '@waganda/schemas';
import { DynamoDbRepository } from '@/lib/db/repository';
import { mapSpeakers } from '@/lib/domain/speaker';
import { computeAgreementScore } from '@/lib/domain/agreement';
import { toSpeakerSegments, toTranscript, type TranscribeOutput } from '@/lib/analysis/transcript';
import { SOMMELIER_PROMPT_VERSION, analyzeWithBedrock } from '@/lib/agent/sommelierDirect';
import { assertExternalCallAllowed } from '@/lib/aws/testGuard';

function localS3(): S3Client {
  const endpoint = process.env.WAGANDA_S3_ENDPOINT;
  return new S3Client({
    region: process.env.AWS_REGION ?? 'ap-northeast-2',
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: true,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
}

/** 로컬 S3 에서 녹음 파일을 내려받는다 */
async function downloadAudio(audioKey: string, destDir: string): Promise<string> {
  const bucket = process.env.WAGANDA_MEDIA_BUCKET!;
  const result = await localS3().send(new GetObjectCommand({ Bucket: bucket, Key: audioKey }));
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) throw new Error(`녹음 파일을 읽을 수 없습니다: ${audioKey}`);

  const dest = join(destDir, audioKey.split('/').pop() ?? 'audio.webm');
  writeFileSync(dest, bytes);
  return dest;
}

/** ffmpeg 로 16kHz 모노 WAV 로 정규화한다 (배포판 오디오 Lambda 와 동일 전처리) */
function normalizeToWav(src: string, destDir: string): string {
  const dest = join(destDir, 'normalized.wav');
  execFileSync(process.env.FFMPEG_BIN ?? 'ffmpeg', [
    '-y',
    '-i',
    src,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-vn',
    dest,
  ]);
  return dest;
}

/** 로컬 Python venv 로 음향 특징을 추출한다 (audio/features.py 재사용) */
function extractAcoustic(wavPath: string): Acoustic {
  const python = process.env.WAGANDA_PYTHON ?? 'audio/.venv/bin/python';
  const code = [
    'import json,sys',
    'sys.path.insert(0, "audio")',
    'from handler import extract_features_from_wav',
    'print(json.dumps(extract_features_from_wav(sys.argv[1])))',
  ].join('\n');

  const stdout = execFileSync(python, ['-c', code, wavPath], { encoding: 'utf8' });
  return Acoustic.parse(JSON.parse(stdout));
}

/** 실제 Transcribe 로 트랜스크립션을 수행한다 */
async function runTranscribe(
  wavPath: string,
  tastingId: string,
  recordingId: string,
): Promise<TranscribeOutput> {
  assertExternalCallAllowed('Amazon Transcribe 트랜스크립션');

  const bucket = process.env.WAGANDA_TRANSCRIBE_BUCKET;
  if (!bucket) {
    throw new Error(
      'WAGANDA_TRANSCRIBE_BUCKET 이 필요합니다. Transcribe 는 S3 에 있는 파일만 읽습니다.\n' +
        '버킷을 만든 뒤 .env.local 에 지정하세요.',
    );
  }

  const region = process.env.AWS_REGION ?? 'ap-northeast-2';
  const s3 = new S3Client({ region });
  const key = `transcribe-input/${tastingId}/${recordingId}.wav`;

  console.log(`[3/6] 오디오를 S3(${bucket})로 업로드…`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(wavPath),
      ContentType: 'audio/wav',
    }),
  );

  // 작업명은 결정론적으로 만들어 재시도 시 중복 생성을 막는다 (배포판과 동일 규칙)
  const jobName = `waganda-${tastingId}-${recordingId}`.slice(0, 200);
  const transcribe = new TranscribeClient({ region });

  console.log(`[3/6] Transcribe 시작 (ko-KR, 화자분리 2명): ${jobName}`);
  try {
    await transcribe.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: 'ko-KR',
        Media: { MediaFileUri: `s3://${bucket}/${key}` },
        Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
      }),
    );
  } catch (error) {
    // 같은 이름의 작업이 이미 있으면 그 결과를 그대로 쓴다 (멱등)
    if (!(error instanceof Error) || !error.name.includes('Conflict')) throw error;
    console.log('[3/6] 같은 이름의 작업이 이미 있어 결과를 재사용합니다.');
  }

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { TranscriptionJob } = await transcribe.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    );
    const status = TranscriptionJob?.TranscriptionJobStatus;

    if (status === 'COMPLETED') {
      const uri = TranscriptionJob?.Transcript?.TranscriptFileUri;
      if (!uri) throw new Error('Transcribe 결과 URI 가 없습니다.');
      const response = await fetch(uri);
      const output = (await response.json()) as TranscribeOutput;

      // 개인 음성을 클라우드에 남기지 않는다 (버킷 수명주기와 별개로 즉시 삭제)
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        console.log('\n      업로드한 오디오 삭제 완료');
      } catch {
        console.warn('\n      업로드한 오디오 삭제 실패 — 버킷 수명주기(1일)로 정리됩니다.');
      }

      return output;
    }
    if (status === 'FAILED') {
      throw new Error(`Transcribe 실패: ${TranscriptionJob?.FailureReason ?? '사유 없음'}`);
    }

    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error('Transcribe 대기 시간 초과');
}

export interface LocalAnalysisOptions {
  /** 트랜스크립션을 건너뛴다 (비용 없이 나머지 단계만 확인할 때) */
  skipTranscribe?: boolean;
  /** 진행 로그 출력 (기본: console.log) */
  log?: (message: string) => void;
}

export interface LocalAnalysisResult {
  tastingId: string;
  aiRating?: number;
  highlightCount: number;
  mappingConfidence: string;
  summary: string;
}

/** 로컬에서 분석 파이프라인을 끝까지 실행한다 */
export async function runLocalAnalysis(
  tastingId: string,
  options: LocalAnalysisOptions = {},
): Promise<LocalAnalysisResult> {
  const skipTranscribe = options.skipTranscribe ?? false;
  const log = options.log ?? ((message: string) => console.log(message));

  const repo = new DynamoDbRepository();
  const nowIso = () => new Date().toISOString();

  log(`[1/6] 시음 ${tastingId} 조회…`);
  const bundle = await repo.queryTastingBundle(tastingId);
  if (!bundle.meta) throw new Error(`시음을 찾을 수 없습니다: ${tastingId}`);
  const recording = bundle.recordings[0];
  if (!recording) throw new Error('녹음이 없습니다. 먼저 /record 에서 녹음을 남기세요.');
  if (!bundle.meta.wineId) {
    throw new Error('와인 정보가 아직 없습니다. 라벨 사진이나 이름을 연결한 뒤 분석하세요.');
  }

  const wine = await repo.getWine(bundle.meta.wineId);

  // 1) 작업 레코드 준비 (멱등)
  const job: Job = bundle.job ?? {
    type: 'JOB',
    tastingId,
    status: 'queued',
    completedSteps: [],
    attempts: 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    rev: 0,
  };
  await repo.putJob({
    ...job,
    status: 'transcribing',
    startedAt: job.startedAt ?? nowIso(),
    updatedAt: nowIso(),
  });

  const workDir = mkdtempSync(join(tmpdir(), 'waganda-analyze-'));

  // 2) 음향 특징
  log('[2/6] 녹음 내려받기 + 음향 특징 추출…');
  const audioPath = await downloadAudio(recording.audioKey, workDir);
  const wavPath = normalizeToWav(audioPath, workDir);
  const acoustic = extractAcoustic(wavPath);
  log(
    `      길이 ${acoustic.durationSec.toFixed(1)}초 · 침묵 ${acoustic.silences.length}회 · 웃음후보 ${acoustic.laughterCandidates.length}회`,
  );

  // 3) 트랜스크립션
  let transcribeOutput: TranscribeOutput | undefined;
  if (skipTranscribe) {
    log('[3/6] --skip-transcribe — 트랜스크립션을 건너뜁니다.');
  } else {
    transcribeOutput = await runTranscribe(wavPath, tastingId, recording.id);
    log('\n      트랜스크립션 완료');
  }

  const transcript = transcribeOutput ? toTranscript(transcribeOutput) : undefined;
  const speakerSegments = transcribeOutput ? toSpeakerSegments(transcribeOutput) : [];

  // 4) 화자 매핑 (F0 상대 비교 — 순수 함수)
  const speakers = mapSpeakers(acoustic.f0Track, speakerSegments);
  log(
    `[4/6] 화자 매핑: 신뢰도 ${speakers.mappingConfidence}` +
      (speakers.medianF0?.gapHz != null ? ` (gap ${speakers.medianF0.gapHz.toFixed(1)}Hz)` : ''),
  );

  const updatedRecording: Recording = {
    ...recording,
    acoustic,
    transcript,
    speakers,
    updatedAt: nowIso(),
  };
  await repo.putRecording(updatedRecording);

  // 5) 소믈리에 분석
  await repo.putJob({ ...job, status: 'analyzing', updatedAt: nowIso() });
  log('[5/6] 소믈리에 분석 (Bedrock 직접 호출)…');

  const result = await analyzeWithBedrock({
    wine: {
      name: wine?.name ?? '(알 수 없는 와인)',
      vintage: wine?.vintage,
      grapes: wine?.grapes,
    },
    transcript,
    acoustic,
    speakers,
  });

  if (!result.ok) {
    await repo.putJob({
      ...job,
      status: 'failed',
      lastError: result.reason,
      attempts: job.attempts + 1,
      updatedAt: nowIso(),
      finishedAt: nowIso(),
    });
    throw new Error(`분석 실패(스키마 검증 ${result.attempts}회): ${result.reason}`);
  }

  const output = result.output;
  const agreementScore = output.reactions
    ? computeAgreementScore(output.reactions.speaker_1, output.reactions.speaker_2)
    : undefined;

  // 6) 저장 + 완료
  const analysis: Analysis = {
    type: 'ANALYSIS',
    tastingId,
    summary: output.summary,
    highlights: output.highlights,
    aiRating: output.aiRating,
    notes: output.notes,
    evidence: output.evidence,
    speakerContrast: output.speakerContrast,
    comparisonToPast: output.comparisonToPast,
    reactions: output.reactions,
    emotionTimeline: output.emotionTimeline,
    agreementScore,
    promptVersion: SOMMELIER_PROMPT_VERSION,
    modelId: process.env.WAGANDA_BEDROCK_MODEL_ID ?? 'bedrock-default',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: bundle.analysis?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    rev: bundle.analysis?.rev ?? 0,
  };
  await repo.putAnalysis(analysis);

  await repo.putJob({
    ...job,
    status: 'completed',
    completedSteps: [
      'ensure_job',
      'start_transcription',
      'extract_acoustic',
      'load_state',
      'map_speakers',
      'sommelier_analysis',
      'persist_and_publish',
    ],
    updatedAt: nowIso(),
    finishedAt: nowIso(),
  });

  log('[6/6] 저장 완료');
  log(
    `평점 ${output.aiRating ?? '-'} · 하이라이트 ${output.highlights.length}개 · 근거 ${output.evidence.length}개`,
  );

  return {
    tastingId,
    aiRating: output.aiRating,
    highlightCount: output.highlights.length,
    mappingConfidence: speakers.mappingConfidence,
    summary: output.summary,
  };
}
