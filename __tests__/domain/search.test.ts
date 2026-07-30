/**
 * lib/domain/search.ts 테스트 — 정규화 부분일치 검색
 */
import { describe, expect, it } from 'vitest';
import { matchWines, type SearchableWine } from '@/lib/domain/search';

const wines: SearchableWine[] = [
  {
    wineId: 'w1',
    name: 'Chablis Premier Cru',
    wineryName: 'Domaine ABC',
    regionName: 'Chablis',
    grapes: ['Chardonnay'],
  },
  {
    wineId: 'w2',
    name: 'Barolo Riserva',
    wineryName: 'Cantina XYZ',
    regionName: 'Piedmont',
    grapes: ['Nebbiolo'],
  },
  {
    wineId: 'w3',
    name: '샤블리 그랑크뤼',
    wineryName: '도멘 테스트',
    regionName: '샤블리',
    grapes: ['Chardonnay'],
  },
];

describe('matchWines', () => {
  it('이름 부분일치로 검색된다', () => {
    const result = matchWines(wines, 'chablis');
    expect(result.map((r) => r.wineId)).toContain('w1');
  });

  it('빈 쿼리는 빈 결과를 반환한다', () => {
    expect(matchWines(wines, '')).toEqual([]);
  });

  it('와이너리명 부분일치로 검색된다', () => {
    const result = matchWines(wines, 'cantina');
    expect(result.map((r) => r.wineId)).toEqual(['w2']);
    expect(result[0].matchedFields).toContain('wineryName');
  });

  it('지역명 부분일치로 검색된다', () => {
    const result = matchWines(wines, 'piedmont');
    expect(result.map((r) => r.wineId)).toEqual(['w2']);
    expect(result[0].matchedFields).toContain('regionName');
  });

  it('품종 부분일치로 검색된다', () => {
    const result = matchWines(wines, 'chardonnay');
    expect(result.map((r) => r.wineId).sort()).toEqual(['w1', 'w3']);
  });

  it('대소문자를 구분하지 않는다', () => {
    const result = matchWines(wines, 'BAROLO');
    expect(result.map((r) => r.wineId)).toEqual(['w2']);
  });

  it('공백을 무시하고 매칭한다', () => {
    const result = matchWines(wines, 'premier cru');
    expect(result.map((r) => r.wineId)).toEqual(['w1']);
  });

  it('한글 NFKC 정규화 부분일치를 지원한다', () => {
    const result = matchWines(wines, '샤블리');
    // w1(Chablis, 영문)은 매칭되지 않고 w3(샤블리, 한글)만 매칭된다
    expect(result.map((r) => r.wineId)).toEqual(['w3']);
  });

  it('일치하는 필드가 없으면 결과에서 제외된다', () => {
    const result = matchWines(wines, 'nonexistentquery');
    expect(result).toEqual([]);
  });

  it('여러 필드가 매칭되면 점수가 더 높아 우선 정렬된다', () => {
    const multiMatch: SearchableWine[] = [
      { wineId: 'onlyname', name: 'Test Wine', grapes: [] },
      { wineId: 'nameandregion', name: 'Test Region Wine', regionName: 'Test', grapes: [] },
    ];
    const result = matchWines(multiMatch, 'test');
    expect(result[0].wineId).toBe('nameandregion'); // name + regionName 매칭으로 더 높은 점수
  });
});
