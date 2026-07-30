import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InMemoryRepository } from '../views/testRepository';
import { createWine, fillMissingWineFields } from '@/lib/services/wines';
import { getWineDetailView, getWineListView } from '@/lib/views/read';
import { winePlaceParts } from '@/lib/domain/region';
import { WineList } from '@/components/wine/WineList';
import { WineInfoCard } from '@/components/wine/WineInfoCard';
import type { Wine } from '@waganda/schemas';

/**
 * __tests__/views/wine-place-fallback.test.tsx — 카탈로그 참조가 없는 와인의 세부 정보 표시.
 *
 * 라벨 인식으로 만들어진 와인(예: "19 Crimes")은 winery/region 엔티티가 없다.
 * 참조만 읽던 화면에서는 산지·와이너리 줄이 통째로 비어 어떤 와인인지 알 수 없었다.
 * 인식·검색으로 얻은 이름 텍스트를 폴백으로 쓰는지 검증한다.
 */
function draftWine(overrides: Partial<Wine> = {}): Wine {
  return {
    id: 'wine-19crimes',
    type: 'WINE',
    name: '19 Crimes',
    nameNormalized: '19crimes',
    wineType: 'red',
    country: 'Australia',
    regionName: 'South Australia',
    wineryName: '19 Crimes',
    grapes: ['Shiraz'],
    alcoholPercent: 13.5,
    labelTags: [],
    tags: [],
    sourceUrls: [],
    draft: true,
    schemaVersion: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    rev: 0,
    ...overrides,
  };
}

describe('winePlaceParts', () => {
  it('카탈로그 지역 경로가 있으면 그것을 국가 뒤에 붙인다', () => {
    expect(
      winePlaceParts({ country: '프랑스', regionName: '무시됨' }, ['프랑스', '보르도']),
    ).toEqual(['프랑스', '보르도']);
  });

  it('지역 경로가 없으면 자유 텍스트 지역명을 쓴다', () => {
    expect(winePlaceParts({ country: 'Australia', regionName: 'South Australia' }, [])).toEqual([
      'Australia',
      'South Australia',
    ]);
  });

  it('국가와 지역명이 같으면 한 번만 표시한다', () => {
    expect(winePlaceParts({ country: 'Australia', regionName: 'Australia' }, [])).toEqual([
      'Australia',
    ]);
  });

  it('둘 다 없으면 빈 배열을 반환한다', () => {
    expect(winePlaceParts({}, [])).toEqual([]);
  });
});

describe('와인 목록 카드', () => {
  it('참조가 없어도 산지와 품종이 보인다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(draftWine({ draft: false }));

    const wines = await getWineListView(repo);
    render(<WineList wines={wines} />);

    // 이름과 와이너리가 모두 "19 Crimes" 라 두 번 나온다 (브랜드=생산자인 와인)
    expect(screen.getAllByText('19 Crimes')).toHaveLength(2);
    expect(screen.getByText('Australia > South Australia')).toBeInTheDocument();
    expect(screen.getByText('품종: Shiraz')).toBeInTheDocument();
  });
});

describe('와인 정보 카드', () => {
  it('참조가 없으면 인식·검색으로 얻은 이름으로 산지·와이너리를 채운다', () => {
    render(<WineInfoCard wine={draftWine()} regionPath={[]} />);

    expect(screen.getByText('Australia > South Australia')).toBeInTheDocument();
    // dt 라벨과 dd 값이 짝을 이룬다
    expect(screen.getByText('와이너리')).toBeInTheDocument();
    expect(screen.getByText('Shiraz')).toBeInTheDocument();
  });
});

describe('와인 상세 뷰 데이터', () => {
  it('createWine 이 wineryName·regionName 을 보존한다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, {
      name: '19 Crimes',
      country: 'Australia',
      regionName: 'South Australia',
      wineryName: '19 Crimes',
      draft: true,
    });

    const view = await getWineDetailView(repo, wine.id);
    expect(view?.wine.regionName).toBe('South Australia');
    expect(view?.wine.wineryName).toBe('19 Crimes');
    // 카탈로그 참조가 없으므로 계층 경로는 비어 있다 (지역 탐색은 regionId 기반)
    expect(view?.regionPath).toEqual([]);
  });

  it('fillMissingWineFields 가 빈 이름 필드만 채운다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '19 Crimes', wineryName: '내가 고친 이름' });

    const { filled, wine: updated } = await fillMissingWineFields(repo, wine.id, {
      wineryName: '자동 인식 이름',
      regionName: 'South Australia',
    });

    expect(filled).toContain('regionName');
    expect(filled).not.toContain('wineryName');
    expect(updated.wineryName).toBe('내가 고친 이름');
    expect(updated.regionName).toBe('South Australia');
  });

  it('이름 텍스트로도 와인을 검색할 수 있다', async () => {
    const repo = new InMemoryRepository();
    await repo.putWine(draftWine({ draft: false }));

    const found = await getWineListView(repo, 'South Australia');
    expect(found.map((w) => w.name)).toEqual(['19 Crimes']);
  });
});
