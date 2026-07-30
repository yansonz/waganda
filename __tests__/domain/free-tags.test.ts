/**
 * 자유 태그 테스트.
 *
 * 목적: 라벨 모티프("범죄자 초상", "새 그림")와 특징("과실향 강함")을 버리지 않고 저장해,
 * 나중에 "평점 좋은 와인은 라벨에 새가 있더라" 같은 발견(R8)의 축으로 쓴다.
 *
 * 태그는 표기를 통일하지 않고 **있는 그대로** 저장한다.
 * 인사이트는 나중에 LLM 이 전체를 훑어 찾으므로("범죄자 초상"·"criminal portrait" 를 모델이 묶는다),
 * 코드가 미리 뭉개면 원문 정보가 사라진다. 여기서는 저장 안전장치만 검증한다.
 */
import { describe, expect, it } from 'vitest';
import { createWine, fillMissingWineFields, sanitizeTags } from '@/lib/services/wines';
import { computeStats } from '@/lib/domain/stats';
import type { StatsInputTasting } from '@/lib/domain/types';
import { InMemoryRepository } from '../views/testRepository';

describe('sanitizeTags', () => {
  it('앞뒤 공백만 정리하고 표기는 그대로 둔다', () => {
    expect(sanitizeTags(['  새 그림 ', 'Bird Drawing', 'BIRD DRAWING'])).toEqual([
      '새 그림',
      'Bird Drawing',
      'BIRD DRAWING',
    ]);
  });

  it('완전히 같은 태그만 중복 제거한다', () => {
    expect(sanitizeTags(['새 그림', '새 그림', '새  그림'])).toEqual(['새 그림', '새  그림']);
  });

  it('빈 값과 과도하게 긴 태그는 버린다', () => {
    expect(sanitizeTags(['', '   ', 'a'.repeat(41), '정상'])).toEqual(['정상']);
  });

  it('개수 상한을 지킨다', () => {
    expect(sanitizeTags(Array.from({ length: 40 }, (_, i) => `tag${i}`))).toHaveLength(30);
  });

  it('undefined 는 빈 배열', () => {
    expect(sanitizeTags(undefined)).toEqual([]);
  });
});

describe('와인 저장', () => {
  it('자유 태그와 한 줄 특징을 함께 저장한다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, {
      name: '19 Crimes Shiraz',
      tags: ['범죄자 초상', '빈티지 판화', '과실향 강함'],
      characterNote: '잘 익은 검은 과실과 바닐라 오크가 두드러진다',
      draft: true,
    });

    expect(wine.tags).toEqual(['범죄자 초상', '빈티지 판화', '과실향 강함']);
    expect(wine.characterNote).toContain('바닐라 오크');
  });

  it('중복 와인에 붙일 때 비어 있던 태그를 채운다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '19 Crimes Shiraz' });

    const result = await fillMissingWineFields(repo, wine.id, {
      tags: ['새 그림'],
      characterNote: '한 줄 특징',
    });

    expect(result.filled).toContain('tags');
    expect(result.filled).toContain('characterNote');
    expect(result.wine.tags).toEqual(['새 그림']);
  });

  it('이미 태그가 있으면 덮어쓰지 않는다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '19 Crimes', tags: ['기존 태그'] });

    const result = await fillMissingWineFields(repo, wine.id, { tags: ['새 태그'] });
    expect(result.wine.tags).toEqual(['기존 태그']);
    expect(result.filled).not.toContain('tags');
  });
});

describe('tag 축 탐색 (R8)', () => {
  function tasting(overrides: Partial<StatsInputTasting>): StatsInputTasting {
    return {
      tastingId: 't',
      wineId: 'w',
      wineName: '와인',
      tastedAt: '2026-01-01T12:00:00.000Z',
      grapes: [],
      labelTags: [],
      tags: [],
      hadLaughter: false,
      ...overrides,
    } as StatsInputTasting;
  }

  it('자유 태그별 평균 평점을 계산한다', () => {
    const tastings = [
      tasting({ tastingId: 't1', tags: ['새 그림', '금박 테두리'], manualRating: 5 }),
      tasting({ tastingId: 't2', tags: ['새 그림'], manualRating: 4.5 }),
      tasting({ tastingId: 't3', tags: ['새 그림', '미니멀'], manualRating: 5 }),
      tasting({ tastingId: 't4', tags: ['미니멀'], manualRating: 2 }),
      tasting({ tastingId: 't5', tags: ['미니멀'], manualRating: 2.5 }),
      tasting({ tastingId: 't6', tags: ['미니멀'], manualRating: 3 }),
    ];

    const result = computeStats(tastings, {
      groupBy: 'tag',
      metric: 'meanRating',
      minSampleSize: 3,
    });

    const bird = result.groups.find((g) => g.key === '새 그림');
    const minimal = result.groups.find((g) => g.key === '미니멀');

    expect(bird?.n).toBe(3);
    expect(bird?.value).toBeCloseTo(4.83, 1);
    expect(minimal?.n).toBe(4);
    // "새 그림" 이 있는 와인의 평점이 전체 평균보다 높다는 신호가 잡힌다
    expect(bird!.deltaVsOverall).toBeGreaterThan(0);
    expect(minimal!.deltaVsOverall).toBeLessThan(0);
  });

  it('한 시음이 여러 태그 그룹에 기여한다 (다중값 축)', () => {
    const result = computeStats(
      [
        tasting({ tastingId: 't1', tags: ['새 그림', '금박 테두리'], manualRating: 5 }),
        tasting({ tastingId: 't2', tags: ['새 그림', '금박 테두리'], manualRating: 4 }),
      ],
      { groupBy: 'tag', metric: 'meanRating', minSampleSize: 2 },
    );

    expect(result.groups.map((g) => g.key).sort()).toEqual(['금박 테두리', '새 그림']);
  });

  it('태그가 없는 시음은 어느 그룹에도 들어가지 않는다', () => {
    const result = computeStats(
      [
        tasting({ tastingId: 't1', tags: [], manualRating: 5 }),
        tasting({ tastingId: 't2', tags: ['새 그림'], manualRating: 4 }),
        tasting({ tastingId: 't3', tags: ['새 그림'], manualRating: 4 }),
      ],
      { groupBy: 'tag', metric: 'meanRating', minSampleSize: 2 },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe('새 그림');
  });
});
