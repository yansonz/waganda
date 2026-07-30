/**
 * lib/domain/search.ts — 와인 검색 (R4)
 *
 * 벡터 검색 없이 정규화(소문자·공백제거·NFKC) 후 부분일치로 검색한다.
 * 이름·와이너리명·지역명·품종을 대상으로 하며, 매칭 필드를 근거로 반환하고
 * 점수순으로 정렬한다.
 */

/** matchWines 가 소비하는 와인 뷰의 최소 형태 */
export interface SearchableWine {
  wineId: string;
  name: string;
  wineryName?: string;
  regionName?: string;
  grapes: string[];
}

/** 매칭된 필드 종류 */
export type MatchedField = 'name' | 'wineryName' | 'regionName' | 'grape';

/** 검색 결과 — 매칭 필드를 근거로 포함하고 점수순 정렬 */
export interface WineMatch {
  wineId: string;
  score: number;
  matchedFields: MatchedField[];
}

/** 필드별 가중치 — 이름 일치가 가장 중요하다 */
const FIELD_WEIGHT: Record<MatchedField, number> = {
  name: 3,
  wineryName: 2,
  regionName: 1,
  grape: 1,
};

/** 소문자화 · 공백 제거 · NFKC 정규화 */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 와인 목록에서 query 와 부분일치하는 와인들을 이름·와이너리명·지역명·품종 기준으로 찾는다.
 * 정규화(소문자·공백제거·NFKC) 후 부분일치를 판정하며, 매칭 필드를 근거로 포함하고
 * 점수(가중치 합) 내림차순으로 정렬한다. query 가 빈 문자열이면 빈 배열을 반환한다.
 */
export function matchWines(wines: SearchableWine[], query: string): WineMatch[] {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length === 0) return [];

  const matches: WineMatch[] = [];

  for (const wine of wines) {
    const matchedFields: MatchedField[] = [];

    if (normalize(wine.name).includes(normalizedQuery)) {
      matchedFields.push('name');
    }
    if (wine.wineryName && normalize(wine.wineryName).includes(normalizedQuery)) {
      matchedFields.push('wineryName');
    }
    if (wine.regionName && normalize(wine.regionName).includes(normalizedQuery)) {
      matchedFields.push('regionName');
    }
    if (wine.grapes.some((g) => normalize(g).includes(normalizedQuery))) {
      matchedFields.push('grape');
    }

    if (matchedFields.length === 0) continue;

    const score = matchedFields.reduce((acc, f) => acc + FIELD_WEIGHT[f], 0);
    matches.push({ wineId: wine.wineId, score, matchedFields });
  }

  matches.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.wineId.localeCompare(b.wineId),
  );
  return matches;
}
