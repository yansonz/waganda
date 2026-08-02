import { GSI1_INDEX_NAME } from '@/lib/db/keys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, Job, Tasting, Wine } from '@waganda/schemas';
import { resetDocClient, setDocClient } from '@/lib/db/client';
import { DynamoDbRepository } from '@/lib/db/repository';
import { ConflictError } from '@/lib/db/errors';

/** send() 를 vi.fn() 스텁으로 갖는 최소 DocumentClient 목 */
function createMockDocClient() {
  return { send: vi.fn() };
}

type MockDocClient = ReturnType<typeof createMockDocClient>;

describe('DynamoDbRepository', () => {
  let mockClient: MockDocClient;
  let repo: DynamoDbRepository;

  beforeEach(() => {
    mockClient = createMockDocClient();
    // DynamoDBDocumentClient 형태로 캐스팅해 주입한다 — 테스트에서는 send() 만 필요.
    setDocClient(mockClient as unknown as Parameters<typeof setDocClient>[0]);
    repo = new DynamoDbRepository();
  });

  afterEach(() => {
    resetDocClient();
    vi.clearAllMocks();
  });

  const baseWine: Wine = {
    id: 'w1',
    type: 'WINE',
    name: 'Barolo 2018',
    nameNormalized: 'barolo 2018',
    grapes: ['Nebbiolo'],
    labelTags: [],
    sourceUrls: [],
    draft: false,
    tags: [],
    schemaVersion: 2,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
  };

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

  describe('get/put — 와인', () => {
    it('getWine 은 Item 을 파싱해 반환한다', async () => {
      mockClient.send.mockResolvedValueOnce({ Item: { ...baseWine, pk: 'WINE#w1', sk: 'META' } });

      const result = await repo.getWine('w1');

      expect(result?.id).toBe('w1');
      expect(mockClient.send).toHaveBeenCalledTimes(1);
    });

    it('getWine 은 Item 이 없으면 undefined 를 반환한다', async () => {
      mockClient.send.mockResolvedValueOnce({});
      const result = await repo.getWine('missing');
      expect(result).toBeUndefined();
    });

    it('putWine 은 gsi1pk/gsi1sk 를 포함해 PutCommand 를 보낸다', async () => {
      mockClient.send.mockResolvedValueOnce({});
      await repo.putWine(baseWine);

      expect(mockClient.send).toHaveBeenCalledTimes(1);
      const sentCommand = mockClient.send.mock.calls[0][0];
      expect(sentCommand.input.Item).toMatchObject({
        pk: 'WINE#w1',
        sk: 'META',
        gsi1pk: 'TYPE#WINE',
        gsi1sk: 'barolo 2018',
      });
    });
  });

  describe('patch — 낙관적 동시성', () => {
    it('rev 일치 시 정상적으로 갱신하고 rev 를 +1 한다', async () => {
      const updated: Wine = { ...baseWine, name: 'Barolo Riserva 2018', rev: 1 };
      mockClient.send.mockResolvedValueOnce({ Attributes: updated });

      const result = await repo.patchWine('w1', 0, { name: 'Barolo Riserva 2018' });

      expect(result.rev).toBe(1);
      const sentCommand = mockClient.send.mock.calls[0][0];
      expect(sentCommand.input.ConditionExpression).toBe('rev = :expectedRev');
      expect(sentCommand.input.ExpressionAttributeValues[':expectedRev']).toBe(0);
    });

    it('rev 불일치(ConditionalCheckFailedException) 시 ConflictError 를 던진다', async () => {
      const conditionalError = Object.assign(new Error('conflict'), {
        name: 'ConditionalCheckFailedException',
      });
      mockClient.send.mockRejectedValueOnce(conditionalError);

      await expect(repo.patchWine('w1', 5, { name: 'X' })).rejects.toThrow(ConflictError);
    });

    it('ConditionalCheckFailedException 이외의 에러는 그대로 전파한다', async () => {
      const otherError = new Error('network error');
      mockClient.send.mockRejectedValueOnce(otherError);

      await expect(repo.patchWine('w1', 0, { name: 'X' })).rejects.toThrow('network error');
    });

    it('patch 필드 값이 undefined 면 SET 표현식·ExpressionAttributeValues 에서 제외한다', async () => {
      // 회귀 배경: toAnalysisRecord 가 만든 Analysis 는 옵셔널 필드가 없을 때
      // { speakerContrast: undefined } 형태로 키 자체는 존재한다. 이 값을 그대로
      // ExpressionAttributeValues 에 넣으면 DynamoDB 가
      // "An expression attribute value used in expression is not defined" 로 거부한다
      // (재분석 시 실제 AWS 호출로 재현됨).
      const updated: Analysis = {
        type: 'ANALYSIS',
        tastingId: 't1',
        summary: '요약',
        highlights: [],
        evidence: [{ field: 'summary', basis: '근거', kind: 'quote' }],
        promptVersion: 'v1',
        modelId: 'model-1',
        schemaVersion: 2,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        rev: 1,
      };
      mockClient.send.mockResolvedValueOnce({ Attributes: updated });

      await repo.patchAnalysis('t1', 0, {
        summary: '요약',
        speakerContrast: undefined,
        comparisonToPast: undefined,
      });

      const sentCommand = mockClient.send.mock.calls[0][0];
      const values = sentCommand.input.ExpressionAttributeValues as Record<string, unknown>;
      const names = sentCommand.input.ExpressionAttributeNames as Record<string, string>;

      expect(Object.values(values)).not.toContain(undefined);
      expect(Object.values(names)).not.toContain('speakerContrast');
      expect(Object.values(names)).not.toContain('comparisonToPast');
      expect(Object.values(names)).toContain('summary');
    });
  });

  describe('queryTastingBundle', () => {
    it('Query(pk=TASTING#id) 결과를 META/REC*/ANALYSIS/JOB 으로 분류한다', async () => {
      const analysis: Analysis = {
        type: 'ANALYSIS',
        tastingId: 't1',
        summary: '좋았다',
        highlights: [],
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
      const job: Job = {
        type: 'JOB',
        tastingId: 't1',
        status: 'completed',
        completedSteps: [],
        attempts: 1,
        schemaVersion: 2,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        rev: 0,
      };

      mockClient.send.mockResolvedValueOnce({
        Items: [
          { ...baseTasting, pk: 'TASTING#t1', sk: 'META' },
          {
            id: 'rec1',
            type: 'RECORDING',
            tastingId: 't1',
            audioKey: 'media/a.mp3',
            durationSec: 60,
            format: 'mp3',
            schemaVersion: 2,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            rev: 0,
            pk: 'TASTING#t1',
            sk: 'REC#rec1',
          },
          { ...analysis, pk: 'TASTING#t1', sk: 'ANALYSIS' },
          { ...job, pk: 'TASTING#t1', sk: 'JOB' },
        ],
      });

      const bundle = await repo.queryTastingBundle('t1');

      expect(bundle.meta?.id).toBe('t1');
      expect(bundle.recordings).toHaveLength(1);
      expect(bundle.recordings[0].id).toBe('rec1');
      expect(bundle.analysis?.tastingId).toBe('t1');
      expect(bundle.job?.status).toBe('completed');
      expect(bundle.quarantined).toHaveLength(0);
      expect(mockClient.send).toHaveBeenCalledTimes(1);
    });

    it('페이지네이션(LastEvaluatedKey)을 모두 순회한다', async () => {
      mockClient.send
        .mockResolvedValueOnce({
          Items: [{ ...baseTasting, pk: 'TASTING#t1', sk: 'META' }],
          LastEvaluatedKey: { pk: 'TASTING#t1', sk: 'META' },
        })
        .mockResolvedValueOnce({
          Items: [
            {
              id: 'rec1',
              type: 'RECORDING',
              tastingId: 't1',
              audioKey: 'a.mp3',
              durationSec: 30,
              format: 'mp3',
              schemaVersion: 2,
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
              rev: 0,
              pk: 'TASTING#t1',
              sk: 'REC#rec1',
            },
          ],
        });

      const bundle = await repo.queryTastingBundle('t1');

      expect(mockClient.send).toHaveBeenCalledTimes(2);
      expect(bundle.meta?.id).toBe('t1');
      expect(bundle.recordings).toHaveLength(1);
    });

    it('파싱 실패 레코드는 격리하고 나머지는 정상 반환한다', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockClient.send.mockResolvedValueOnce({
        Items: [
          { ...baseTasting, pk: 'TASTING#t1', sk: 'META' },
          // ANALYSIS 인데 필수 필드(summary) 누락 → 파싱 실패
          { type: 'ANALYSIS', tastingId: 't1', pk: 'TASTING#t1', sk: 'ANALYSIS' },
        ],
      });

      const bundle = await repo.queryTastingBundle('t1');

      expect(bundle.meta?.id).toBe('t1');
      expect(bundle.analysis).toBeUndefined();
      expect(bundle.quarantined).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('listByType — GSI1', () => {
    it('IndexName=GSI1, gsi1pk=TYPE#<type> 조건으로 조회한다', async () => {
      mockClient.send.mockResolvedValueOnce({
        Items: [
          { ...baseWine, pk: 'WINE#w1', sk: 'META', gsi1pk: 'TYPE#WINE', gsi1sk: 'barolo 2018' },
        ],
      });

      const { items, quarantined } = await repo.listByType<Wine>('WINE', 'asc');

      expect(items).toHaveLength(1);
      expect(quarantined).toHaveLength(0);
      const sentCommand = mockClient.send.mock.calls[0][0];
      // CDK(infrastructure/lib/data-stack.ts)가 만드는 인덱스 이름과 일치해야 한다.
      // 과거 이 테스트가 소문자 'gsi1' 을 고정해 두어 대소문자 불일치 결함을 놓쳤다.
      expect(GSI1_INDEX_NAME).toBe('GSI1');
      expect(sentCommand.input.IndexName).toBe(GSI1_INDEX_NAME);
      expect(sentCommand.input.ExpressionAttributeValues[':gsi1pk']).toBe('TYPE#WINE');
      expect(sentCommand.input.ScanIndexForward).toBe(true);
    });

    it('order=desc 이면 ScanIndexForward=false', async () => {
      mockClient.send.mockResolvedValueOnce({ Items: [] });
      await repo.listByType<Wine>('WINE', 'desc');
      const sentCommand = mockClient.send.mock.calls[0][0];
      expect(sentCommand.input.ScanIndexForward).toBe(false);
    });
  });

  describe('scanAll — 페이지네이션 전부 순회', () => {
    it('LastEvaluatedKey 가 있는 동안 반복 호출한다', async () => {
      mockClient.send
        .mockResolvedValueOnce({
          Items: [{ ...baseWine, pk: 'WINE#w1', sk: 'META' }],
          LastEvaluatedKey: { pk: 'WINE#w1', sk: 'META' },
        })
        .mockResolvedValueOnce({
          Items: [{ ...baseTasting, pk: 'TASTING#t1', sk: 'META' }],
        });

      const { items, quarantined } = await repo.scanAll<Wine | Tasting>();

      expect(mockClient.send).toHaveBeenCalledTimes(2);
      expect(items).toHaveLength(2);
      expect(quarantined).toHaveLength(0);
    });

    it('빈 테이블은 빈 배열을 반환한다', async () => {
      mockClient.send.mockResolvedValueOnce({ Items: [] });
      const { items } = await repo.scanAll();
      expect(items).toEqual([]);
    });
  });
});
