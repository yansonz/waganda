/**
 * lib/services/tastings.ts — 시음 세션 생성·수정, 녹음 등록 서비스.
 *
 * 핵심 규칙:
 * - 수정 시 원본 AI 생성물(Analysis.summary/highlights)은 보존하고
 *   `editedSummary`/`editedHighlights` 로만 새로 쓴다 (design.md, tasks.md 11.9).
 * - 녹음은 세션당 최대 `MAX_RECORDINGS_PER_TASTING`(3)개까지만 등록 가능하다.
 */
import { randomUUID } from 'node:crypto';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_RECORDINGS_PER_TASTING,
  toPriceBand,
  type Analysis,
  type Recording,
  type Tasting,
  type TastingInput,
  type TastingPatch,
} from '@waganda/schemas';
import type { Repository } from '@/lib/db/repository';
import { requireFound } from '@/lib/db/repository';
import { assertRefsExist, refCheck } from '@/lib/db/integrity';
import { ReferenceIntegrityError } from '@/lib/db/errors';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID();
}

/** 시음 세션 생성 — wineId 참조 무결성을 검증한다. 시음자 정보는 받지 않는다 (R2) */
export async function createTasting(repo: Repository, input: TastingInput): Promise<Tasting> {
  await assertRefsExist([
    refCheck('wineId', input.wineId, async () => (await repo.getWine(input.wineId)) !== undefined),
  ]);

  const now = nowIso();
  const tasting: Tasting = {
    id: newId(),
    type: 'TASTING',
    wineId: input.wineId,
    tastedAt: input.tastedAt,
    labelImageKey: input.labelImageKey,
    priceKrw: input.priceKrw,
    priceBand: toPriceBand(input.priceKrw),
    manualRating: input.manualRating,
    memo: input.memo,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  await repo.putTasting(tasting);
  return tasting;
}

/**
 * 시음 세션 수정 — 수동 평점·요약·하이라이트 수정 (11.9).
 *
 * `editedSummary`/`editedHighlights` 는 `Analysis` 레코드에 저장되며,
 * 원본 AI 생성물인 `summary`/`highlights` 필드는 절대 덮어쓰지 않는다.
 * `Tasting` 레코드 자체의 필드(tastedAt/priceKrw/manualRating/memo)는 그대로 patch 한다.
 */
export async function updateTasting(
  repo: Repository,
  id: string,
  expectedRev: number,
  patch: TastingPatch,
): Promise<{ tasting: Tasting; analysis?: Analysis }> {
  const { editedSummary, editedHighlights, rev: _rev, ...tastingFields } = patch;

  const tastingPatch: Partial<Tasting> = { ...tastingFields };
  if (tastingFields.priceKrw !== undefined) {
    tastingPatch.priceBand = toPriceBand(tastingFields.priceKrw);
  }

  const tasting = await repo.patchTasting(id, expectedRev, tastingPatch);

  let analysis: Analysis | undefined;
  if (editedSummary !== undefined || editedHighlights !== undefined) {
    const existingAnalysis = requireFound(
      await repo.getAnalysis(id),
      '수정할 분석 결과가 없습니다. 분석이 완료된 후에 요약·하이라이트를 수정할 수 있습니다.',
    );

    const analysisPatch: Partial<Analysis> = {};
    if (editedSummary !== undefined) analysisPatch.editedSummary = editedSummary;
    if (editedHighlights !== undefined) analysisPatch.editedHighlights = editedHighlights;

    // 원본 summary/highlights 는 patch 대상에 포함하지 않으므로 항상 보존된다.
    analysis = await repo.patchAnalysis(id, existingAnalysis.rev, analysisPatch);
  }

  return { tasting, analysis };
}

/**
 * 시음 세션과 같은 파티션의 하위 레코드를 함께 삭제한다.
 *
 * 녹음·분석·작업을 먼저 지우고 META를 마지막에 지워, 중간 실패가 나도
 * 목록에서 사라진 시음에 고아 하위 레코드만 남는 상황을 피한다.
 * S3 원본 파일 정리는 이 서비스의 Repository 범위 밖이므로 여기서 수행하지 않는다.
 */
export async function deleteTasting(repo: Repository, id: string): Promise<void> {
  requireFound(await repo.getTasting(id), '삭제할 시음 세션을 찾을 수 없습니다.');

  const bundle = await repo.queryTastingBundle(id);
  for (const recording of bundle.recordings) {
    await repo.deleteRecording(id, recording.id);
  }
  if (bundle.analysis) {
    await repo.deleteAnalysis(id);
  }
  if (bundle.job) {
    await repo.deleteJob(id);
  }

  await repo.deleteTasting(id);
}

/** 세션당 등록된 녹음 수를 계산한다 (recordingId 로 이미 취소된 항목은 없다고 가정) */
async function countRecordingsForTasting(repo: Repository, tastingId: string): Promise<number> {
  const bundle = await repo.queryTastingBundle(tastingId);
  return bundle.recordings.length;
}

/** 녹음 등록 상한 초과 에러 */
export class RecordingLimitExceededError extends Error {
  readonly code = 'RECORDING_LIMIT_EXCEEDED';
  readonly status = 400;

  constructor(
    message = `시음 세션당 녹음은 최대 ${MAX_RECORDINGS_PER_TASTING}개까지 등록할 수 있습니다.`,
  ) {
    super(message);
    this.name = 'RecordingLimitExceededError';
  }
}

/**
 * 녹음 레코드 생성 — 세션당 최대 `MAX_RECORDINGS_PER_TASTING`(3)개 제한.
 * S3 업로드 URL 발급은 API 라우트(app/api/tastings/[id]/recordings)에서 담당하고,
 * 이 함수는 한도 검증과 레코드 저장만 수행한다.
 */
export async function createRecording(
  repo: Repository,
  input: {
    /** 지정하지 않으면 새로 생성한다. presign 단계에서 이미 발급한 recordingId 를 재사용할 때 지정한다. */
    id?: string;
    tastingId: string;
    audioKey: string;
    format: Recording['format'];
    durationSec: number;
    sizeBytes?: number;
  },
): Promise<Recording> {
  requireFound(
    await repo.getTasting(input.tastingId),
    '녹음을 추가할 시음 세션을 찾을 수 없습니다.',
  );

  const existingCount = await countRecordingsForTasting(repo, input.tastingId);
  if (existingCount >= MAX_RECORDINGS_PER_TASTING) {
    throw new RecordingLimitExceededError();
  }

  const now = nowIso();
  const recording: Recording = {
    id: input.id ?? newId(),
    type: 'RECORDING',
    tastingId: input.tastingId,
    audioKey: input.audioKey,
    durationSec: input.durationSec,
    format: input.format,
    sizeBytes: input.sizeBytes,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  await repo.putRecording(recording);
  return recording;
}

/** 화자 매핑 교체 (오판 정정, 11.10) */
export async function overrideSpeakerMapping(
  repo: Repository,
  tastingId: string,
  recordingId: string,
  expectedRev: number,
  mapping: { speaker_1: 'yan' | 'robert'; speaker_2: 'yan' | 'robert' } | null,
): Promise<Recording> {
  const recording = requireFound(
    await repo.getRecording(tastingId, recordingId),
    '수정할 녹음을 찾을 수 없습니다.',
  );

  if (!recording.speakers) {
    throw new ReferenceIntegrityError('화자분리 결과가 없어 매핑을 교체할 수 없습니다.', []);
  }

  return repo.patchRecording(tastingId, recordingId, expectedRev, {
    speakers: {
      ...recording.speakers,
      mapping,
      manuallyOverridden: true,
    },
  });
}
