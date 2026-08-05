import { describe, expect, it, vi } from 'vitest';
import type { Analysis, Recording, Tasting } from '@waganda/schemas';
import type { Repository, TastingBundle } from '@/lib/db/repository';
import { ReferenceIntegrityError } from '@/lib/db/errors';
import {
  RecordingLimitExceededError,
  attachWineToTasting,
  createRecording,
  createTasting,
  deleteTasting,
  overrideSpeakerMapping,
  updateTasting,
} from '@/lib/services/tastings';

function makeRepo(overrides: Partial<Repository>): Repository {
  const notImplemented = (name: string) => async () => {
    throw new Error(`Repository.${name} 은 이 테스트에서 스텁되지 않았습니다.`);
  };

  return {
    getWine: notImplemented('getWine'),
    putWine: notImplemented('putWine'),
    patchWine: notImplemented('patchWine'),
    deleteWine: notImplemented('deleteWine'),
    getWinery: notImplemented('getWinery'),
    putWinery: notImplemented('putWinery'),
    patchWinery: notImplemented('patchWinery'),
    deleteWinery: notImplemented('deleteWinery'),
    getRegion: notImplemented('getRegion'),
    putRegion: notImplemented('putRegion'),
    patchRegion: notImplemented('patchRegion'),
    deleteRegion: notImplemented('deleteRegion'),
    getTasting: notImplemented('getTasting'),
    putTasting: notImplemented('putTasting'),
    patchTasting: notImplemented('patchTasting'),
    deleteTasting: notImplemented('deleteTasting'),
    getRecording: notImplemented('getRecording'),
    putRecording: notImplemented('putRecording'),
    patchRecording: notImplemented('patchRecording'),
    deleteRecording: notImplemented('deleteRecording'),
    getAnalysis: notImplemented('getAnalysis'),
    putAnalysis: notImplemented('putAnalysis'),
    patchAnalysis: notImplemented('patchAnalysis'),
    deleteAnalysis: notImplemented('deleteAnalysis'),
    getJob: notImplemented('getJob'),
    putJob: notImplemented('putJob'),
    patchJob: notImplemented('patchJob'),
    deleteJob: notImplemented('deleteJob'),
    getProfile: notImplemented('getProfile'),
    putProfile: notImplemented('putProfile'),
    patchProfile: notImplemented('patchProfile'),
    getDiscovery: notImplemented('getDiscovery'),
    putDiscovery: notImplemented('putDiscovery'),
    patchDiscovery: notImplemented('patchDiscovery'),
    deleteDiscovery: notImplemented('deleteDiscovery'),
    queryTastingBundle: notImplemented('queryTastingBundle'),
    listByType: notImplemented('listByType'),
    scanAll: notImplemented('scanAll'),
    ...overrides,
  } as Repository;
}

const baseTasting: Tasting = {
  id: 't1',
  type: 'TASTING',
  wineId: 'w1',
  tastedAt: '2025-01-01T12:00:00Z',
  schemaVersion: 2,
  createdAt: '2025-01-01T12:00:00Z',
  updatedAt: '2025-01-01T12:00:00Z',
  rev: 0,
};

const baseAnalysis: Analysis = {
  type: 'ANALYSIS',
  tastingId: 't1',
  summary: '원본 AI 요약',
  highlights: [{ quote: '원본 인용', note: '원본 해석' }],
  aiRating: 4,
  notes: { acidity: 3, tannin: 3, body: 3, aroma: 3, finish: 3 },
  evidence: [],
  promptVersion: 'v1',
  modelId: 'model-1',
  schemaVersion: 2,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 0,
};

describe('createTasting', () => {
  it('존재하지 않는 wineId 참조 시 거부한다', async () => {
    const repo = makeRepo({ getWine: async () => undefined });

    await expect(
      createTasting(repo, { wineId: 'missing', tastedAt: '2025-01-01T00:00:00Z' }),
    ).rejects.toThrow(ReferenceIntegrityError);
  });

  it('유효한 wineId 면 시음 세션을 생성하고 priceBand 를 파생한다', async () => {
    const putTasting = vi.fn(async () => undefined);
    const repo = makeRepo({
      getWine: async () => ({ id: 'w1' }) as never,
      putTasting,
    });

    const tasting = await createTasting(repo, {
      wineId: 'w1',
      tastedAt: '2025-01-01T00:00:00Z',
      priceKrw: 35_000,
    });

    expect(tasting.wineId).toBe('w1');
    expect(tasting.lifecycle).toBe('awaiting_audio');
    expect(tasting.priceBand).toBe('20k_50k');
    expect(putTasting).toHaveBeenCalledOnce();
  });

  it('wineId 없이 캡처를 생성하고 와인 조회를 하지 않는다', async () => {
    const getWine = vi.fn();
    const putTasting = vi.fn(async () => undefined);
    const repo = makeRepo({ getWine, putTasting });

    const tasting = await createTasting(repo, { tastedAt: '2025-01-01T00:00:00Z' });

    expect(tasting.wineId).toBeUndefined();
    expect(tasting.lifecycle).toBe('collecting');
    expect(getWine).not.toHaveBeenCalled();
    expect(putTasting).toHaveBeenCalledWith(tasting);
  });

  it('시음자 정보를 받지 않는다 — TastingInput 에 시음자 필드가 없다', async () => {
    const repo = makeRepo({
      getWine: async () => ({ id: 'w1' }) as never,
      putTasting: async () => undefined,
    });
    const tasting = await createTasting(repo, { wineId: 'w1', tastedAt: '2025-01-01T00:00:00Z' });
    expect('taster' in tasting).toBe(false);
  });
});

describe('attachWineToTasting', () => {
  it('녹음이 있는 미연결 캡처를 폴리싱 대기 상태로 전이한다', async () => {
    const patchTasting = vi.fn(async (_id: string, _rev: number, patch: Partial<Tasting>) => ({
      ...baseTasting,
      ...patch,
    }));
    const repo = makeRepo({
      getTasting: async () => ({ ...baseTasting, wineId: undefined, lifecycle: 'collecting' }),
      getWine: async () => ({ id: 'wine-1' }) as never,
      queryTastingBundle: async () => ({
        recordings: [{ id: 'recording-1' }] as Recording[],
        quarantined: [],
      }),
      patchTasting,
    });

    const tasting = await attachWineToTasting(repo, 't1', {
      wineId: 'wine-1',
      labelImageKey: 'labels/first.jpg',
    });

    expect(tasting).toMatchObject({
      wineId: 'wine-1',
      labelImageKey: 'labels/first.jpg',
      lifecycle: 'polishing',
    });
    expect(patchTasting).toHaveBeenCalledWith(
      't1',
      baseTasting.rev,
      expect.objectContaining({ lifecycle: 'polishing' }),
    );
  });
});

describe('updateTasting — 원본 AI 생성물 보존', () => {
  it('editedSummary 수정 시 Analysis.summary(원본)는 patch 대상에 없다', async () => {
    const patchAnalysis = vi.fn(async (_id: string, _rev: number, _patch: Partial<Analysis>) => ({
      ...baseAnalysis,
      editedSummary: '수정된 요약',
    }));
    const repo = makeRepo({
      patchTasting: async () => baseTasting,
      getAnalysis: async () => baseAnalysis,
      patchAnalysis,
    });

    await updateTasting(repo, 't1', 0, { editedSummary: '수정된 요약' });

    expect(patchAnalysis).toHaveBeenCalledWith(
      't1',
      baseAnalysis.rev,
      expect.objectContaining({ editedSummary: '수정된 요약' }),
    );
    const patchArg = patchAnalysis.mock.calls[0][2];
    expect(patchArg).not.toHaveProperty('summary');
    expect(patchArg).not.toHaveProperty('highlights');
  });

  it('editedHighlights 수정도 원본 highlights 를 건드리지 않는다', async () => {
    const patchAnalysis = vi.fn(
      async (_id: string, _rev: number, _patch: Partial<Analysis>) => baseAnalysis,
    );
    const repo = makeRepo({
      patchTasting: async () => baseTasting,
      getAnalysis: async () => baseAnalysis,
      patchAnalysis,
    });

    await updateTasting(repo, 't1', 0, {
      editedHighlights: [{ quote: '수정 인용', note: '수정 해석' }],
    });

    const patchArg = patchAnalysis.mock.calls[0][2];
    expect(patchArg).toEqual({ editedHighlights: [{ quote: '수정 인용', note: '수정 해석' }] });
  });

  it('manualRating/memo 등 Tasting 필드만 수정하면 Analysis 를 건드리지 않는다', async () => {
    const patchTasting = vi.fn(async () => ({ ...baseTasting, manualRating: 4.5 }));
    const getAnalysis = vi.fn();
    const repo = makeRepo({ patchTasting, getAnalysis });

    await updateTasting(repo, 't1', 0, { manualRating: 4.5 });

    expect(patchTasting).toHaveBeenCalledWith(
      't1',
      0,
      expect.objectContaining({ manualRating: 4.5 }),
    );
    expect(getAnalysis).not.toHaveBeenCalled();
  });

  it('priceKrw 수정 시 priceBand 를 재계산한다', async () => {
    const patchTasting = vi.fn(async () => baseTasting);
    const repo = makeRepo({ patchTasting });

    await updateTasting(repo, 't1', 0, { priceKrw: 150_000 });

    expect(patchTasting).toHaveBeenCalledWith(
      't1',
      0,
      expect.objectContaining({ priceKrw: 150_000, priceBand: '100k_200k' }),
    );
  });
});

describe('deleteTasting — 하위 레코드 정리', () => {
  it('녹음·분석·작업을 지운 뒤 시음 메타 레코드를 마지막에 삭제한다', async () => {
    const recordings: Recording[] = [
      {
        id: 'rec1',
        type: 'RECORDING',
        tastingId: 't1',
        audioKey: 'recordings/t1/rec1.mp3',
        durationSec: 30,
        format: 'mp3',
        schemaVersion: 2,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        rev: 0,
      },
      {
        id: 'rec2',
        type: 'RECORDING',
        tastingId: 't1',
        audioKey: 'recordings/t1/rec2.mp3',
        durationSec: 60,
        format: 'm4a',
        schemaVersion: 2,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        rev: 0,
      },
    ];
    const operations: string[] = [];
    const repo = makeRepo({
      getTasting: async () => baseTasting,
      queryTastingBundle: async () => ({
        recordings,
        analysis: baseAnalysis,
        job: {
          type: 'JOB',
          tastingId: 't1',
          status: 'completed',
          completedSteps: [],
          attempts: 0,
          schemaVersion: 2,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
          rev: 0,
        },
        quarantined: [],
      }),
      deleteRecording: async (_tastingId, recordingId) => {
        operations.push(`recording:${recordingId}`);
      },
      deleteAnalysis: async () => {
        operations.push('analysis');
      },
      deleteJob: async () => {
        operations.push('job');
      },
      deleteTasting: async () => {
        operations.push('tasting');
      },
    });

    await deleteTasting(repo, 't1');

    expect(operations).toEqual(['recording:rec1', 'recording:rec2', 'analysis', 'job', 'tasting']);
  });
});

describe('createRecording — 세션당 최대 3개 제한', () => {
  function bundleWithRecordings(count: number): TastingBundle {
    const recordings: Recording[] = Array.from({ length: count }, (_, i) => ({
      id: `rec${i}`,
      type: 'RECORDING',
      tastingId: 't1',
      audioKey: `a${i}.mp3`,
      durationSec: 30,
      format: 'mp3',
      schemaVersion: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      rev: 0,
    }));
    return { recordings, quarantined: [] };
  }

  it('0~2개일 때는 등록을 허용한다', async () => {
    const putRecording = vi.fn(async () => undefined);
    const repo = makeRepo({
      getTasting: async () => baseTasting,
      queryTastingBundle: async () => bundleWithRecordings(2),
      putRecording,
    });

    const recording = await createRecording(repo, {
      tastingId: 't1',
      audioKey: 'a.mp3',
      format: 'mp3',
      durationSec: 60,
    });

    expect(recording.tastingId).toBe('t1');
    expect(putRecording).toHaveBeenCalledOnce();
  });

  it('4번째 녹음 등록은 거부한다', async () => {
    const repo = makeRepo({
      getTasting: async () => baseTasting,
      queryTastingBundle: async () => bundleWithRecordings(3),
    });

    await expect(
      createRecording(repo, { tastingId: 't1', audioKey: 'a.mp3', format: 'mp3', durationSec: 60 }),
    ).rejects.toThrow(RecordingLimitExceededError);
  });

  it('존재하지 않는 시음 세션이면 거부한다', async () => {
    const repo = makeRepo({ getTasting: async () => undefined });
    await expect(
      createRecording(repo, {
        tastingId: 'missing',
        audioKey: 'a.mp3',
        format: 'mp3',
        durationSec: 60,
      }),
    ).rejects.toThrow();
  });
});

describe('overrideSpeakerMapping — 화자 매핑 교체', () => {
  const recordingWithSpeakers: Recording = {
    id: 'rec1',
    type: 'RECORDING',
    tastingId: 't1',
    audioKey: 'a.mp3',
    durationSec: 60,
    format: 'mp3',
    speakers: {
      segments: [],
      mapping: { speaker_1: 'yan', speaker_2: 'robert' },
      mappingConfidence: 'high',
      manuallyOverridden: false,
    },
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
  };

  it('두 화자를 교체하고 manuallyOverridden 을 true 로 표시한다', async () => {
    const patchRecording = vi.fn(async () => recordingWithSpeakers);
    const repo = makeRepo({
      getRecording: async () => recordingWithSpeakers,
      patchRecording,
    });

    await overrideSpeakerMapping(repo, 't1', 'rec1', 0, {
      speaker_1: 'robert',
      speaker_2: 'yan',
    });

    expect(patchRecording).toHaveBeenCalledWith(
      't1',
      'rec1',
      0,
      expect.objectContaining({
        speakers: expect.objectContaining({
          mapping: { speaker_1: 'robert', speaker_2: 'yan' },
          manuallyOverridden: true,
        }),
      }),
    );
  });

  it('화자분리 결과가 없으면 교체를 거부한다', async () => {
    const repo = makeRepo({
      getRecording: async () => ({ ...recordingWithSpeakers, speakers: undefined }),
    });

    await expect(
      overrideSpeakerMapping(repo, 't1', 'rec1', 0, { speaker_1: 'yan', speaker_2: 'robert' }),
    ).rejects.toThrow(ReferenceIntegrityError);
  });
});
