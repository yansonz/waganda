/**
 * 평점 표시 정책 회귀 테스트.
 *
 * 정책:
 * 1. 수동 평점과 AI 평점은 **각각 보존**한다 (`Tasting.manualRating` / `Analysis.aiRating`).
 * 2. 화면에는 **하나만** 보여준다 — 수동 평점이 있으면 수동, 없으면 AI.
 * 3. AI 가 음성 분석으로 먼저 판단하고, 편집자가 수동 평점을 넣으면 그것이 우선한다.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CURRENT_SCHEMA_VERSION } from '@waganda/schemas';
import { getTastingDetailView, getTimelineView } from '@/lib/views/read';
import { Rating } from '@/components/common/Rating';
import { InMemoryRepository } from './testRepository';

const now = '2026-07-01T12:00:00.000Z';
const meta = { schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: now, updatedAt: now, rev: 0 };

function buildRepo(options: { manualRating?: number; aiRating?: number }): InMemoryRepository {
  const repo = new InMemoryRepository();

  repo.wines.set('w1', {
    id: 'w1',
    type: 'WINE',
    name: '테스트 와인',
    nameNormalized: '테스트 와인',
    grapes: [],
    labelTags: [],
    sourceUrls: [],
    draft: false,
    tags: [],
    ...meta,
  });

  repo.tastings.set('t1', {
    id: 't1',
    type: 'TASTING',
    wineId: 'w1',
    tastedAt: now,
    manualRating: options.manualRating,
    ...meta,
  });

  if (options.aiRating !== undefined) {
    repo.analyses.set('t1', {
      type: 'ANALYSIS',
      tastingId: 't1',
      summary: '요약',
      highlights: [{ quote: '좋다', note: '긍정 반응' }],
      aiRating: options.aiRating,
      notes: { acidity: 3, tannin: 3, body: 3, aroma: 3, finish: 3 },
      evidence: [{ field: 'aiRating', basis: '발화 근거', kind: 'quote' }],
      promptVersion: 'v1',
      modelId: 'test',
      ...meta,
    });
  }

  return repo;
}

describe('대표 평점 선택 (상세 화면)', () => {
  it('AI 평점만 있으면 AI 평점을 표시한다', async () => {
    const view = await getTastingDetailView(buildRepo({ aiRating: 4 }), 't1');
    expect(view?.displayRating).toBe(4);
    expect(view?.ratingSource).toBe('ai');
  });

  it('수동 평점이 있으면 AI 평점이 있어도 수동 평점을 표시한다', async () => {
    const view = await getTastingDetailView(buildRepo({ manualRating: 4.5, aiRating: 2 }), 't1');
    expect(view?.displayRating).toBe(4.5);
    expect(view?.ratingSource).toBe('manual');
  });

  it('두 평점은 각각 보존된다 (표시만 하나로 좁힌다)', async () => {
    const view = await getTastingDetailView(buildRepo({ manualRating: 4.5, aiRating: 2 }), 't1');
    expect(view?.tasting.manualRating).toBe(4.5);
    expect(view?.analysis?.aiRating).toBe(2);
  });

  it('평점이 하나도 없으면 대표 평점을 만들지 않는다', async () => {
    const view = await getTastingDetailView(buildRepo({}), 't1');
    expect(view?.displayRating).toBeUndefined();
    expect(view?.ratingSource).toBeUndefined();
  });
});

describe('대표 평점 선택 (목록 화면)', () => {
  it('타임라인도 같은 우선순위를 따른다', async () => {
    const withManual = await getTimelineView(buildRepo({ manualRating: 5, aiRating: 1 }));
    expect(withManual[0].displayRating).toBe(5);
    expect(withManual[0].ratingSource).toBe('manual');

    const aiOnly = await getTimelineView(buildRepo({ aiRating: 3.5 }));
    expect(aiOnly[0].displayRating).toBe(3.5);
    expect(aiOnly[0].ratingSource).toBe('ai');
  });
});

describe('표시 형태', () => {
  it('대표 평점 하나만 렌더링하고 출처를 접근성 이름에 담는다', () => {
    render(<Rating value={4.5} label="수동 평점" />);
    expect(screen.getByLabelText('수동 평점 4.5점 (5점 만점)')).toBeInTheDocument();
    // AI 평점 값이 함께 노출되지 않는다
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });
});
