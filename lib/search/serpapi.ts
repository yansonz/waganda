import type { SearchHit } from '@/lib/agent/labelEnrich';
import { assertExternalCallAllowed } from '@/lib/aws/testGuard';
import { getSearchApiKey } from '@/lib/config';

/**
 * lib/search/serpapi.ts — SerpAPI 웹 검색 프로바이더.
 *
 * 라벨 인식 결과 보강(R3)에서 품종·지역 같은 빈 필드를 채울 근거를 찾는 데 쓴다.
 *
 * 무료 티어는 월 호출 수가 제한된다(기본 100회). 그래서 아래를 지킨다.
 * - **빈 필드가 있을 때만** 호출한다 (호출부에서 판단)
 * - 같은 질의는 프로세스 내 캐시로 재사용한다
 * - 실패·타임아웃은 조용히 빈 결과로 처리한다 (보강은 최선 노력이며, 없으면 모델 지식으로 진행)
 *
 * 키는 `SERPAPI_KEY` 로 주입한다. 배포 환경에서는 SSM SecureString 에서 주입해야 하며
 * 소스코드에 두지 않는다.
 */

const ENDPOINT = 'https://serpapi.com/search.json';
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;

/** 프로세스 내 질의 캐시 — 무료 티어 호출 수를 아끼기 위한 것 */
const cache = new Map<string, SearchHit[]>();

/** 테스트·재시작 시 캐시를 비운다 */
export function clearSearchCache(): void {
  cache.clear();
}

interface SerpApiResponse {
  organic_results?: { title?: string; snippet?: string; link?: string }[];
  knowledge_graph?: { title?: string; description?: string; website?: string };
  error?: string;
}

/** SerpAPI 응답에서 우리가 쓰는 형태만 뽑는다 */
export function parseSerpApiResponse(body: SerpApiResponse, limit = 3): SearchHit[] {
  const hits: SearchHit[] = [];

  // 지식 패널이 있으면 가장 신뢰도 높은 근거로 앞에 둔다
  const kg = body.knowledge_graph;
  if (kg?.title && kg.description) {
    hits.push({
      title: kg.title,
      snippet: kg.description,
      url: kg.website && /^https?:\/\//.test(kg.website) ? kg.website : 'https://serpapi.com',
    });
  }

  for (const result of body.organic_results ?? []) {
    if (!result.title || !result.link) continue;
    if (!/^https?:\/\//.test(result.link)) continue;
    hits.push({
      title: result.title,
      snippet: result.snippet ?? '',
      url: result.link,
    });
  }

  return hits.slice(0, limit);
}

/**
 * SerpAPI 로 검색한다. 키가 없거나 실패하면 빈 배열을 돌려준다.
 *
 * `apiKey` 를 넘기지 않으면 `SERPAPI_KEY` 환경변수를 쓴다.
 * 배포 환경은 SSM SecureString 에서 읽은 값을 넘긴다(`resolveSearchProvider`).
 */
export async function serpApiSearch(
  query: string,
  limit = 3,
  apiKey = process.env.SERPAPI_KEY,
): Promise<SearchHit[]> {
  if (!apiKey) return [];

  const cacheKey = `${limit}:${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('num', String(Math.min(MAX_RESULTS, Math.max(limit, 3))));
  // 와인 참조 정보는 영문 자료가 풍부하다
  url.searchParams.set('hl', 'en');

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      console.warn(`[search] SerpAPI 응답 오류 — status=${response.status}`);
      return [];
    }

    const body = (await response.json()) as SerpApiResponse;
    if (body.error) {
      console.warn(`[search] SerpAPI 오류 — ${body.error}`);
      return [];
    }

    const hits = parseSerpApiResponse(body, limit);
    cache.set(cacheKey, hits);
    return hits;
  } catch (error) {
    console.warn(
      `[search] SerpAPI 호출 실패 — ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * 설정된 검색 프로바이더를 돌려준다. 키가 없으면 `undefined` —
 * 보강 단계는 모델 지식만으로 진행한다.
 *
 * 환경변수만 본다. 배포 환경(SSM SecureString)에서는 `resolveSearchProvider()` 를 쓴다.
 */
export function getSearchProvider(): ((query: string) => Promise<SearchHit[]>) | undefined {
  if (!process.env.SERPAPI_KEY) return undefined;
  return (query: string) => {
    // 유료 API 다 — 테스트에서는 검색을 주입해야 한다
    assertExternalCallAllowed('SerpAPI 웹 검색');
    return serpApiSearch(query, 3);
  };
}

/**
 * 검색 프로바이더를 해석한다 — 환경변수 → SSM SecureString 순서.
 *
 * 배포 환경에서는 키를 Lambda·AgentCore 환경변수에 평문으로 두지 않고
 * `/waganda/<env>/search/serpapi-key` 에서 읽는다. 키가 없으면 `undefined` 이고
 * 보강은 검색 없이 진행한다(선택 기능이므로 실패가 아니다).
 */
export async function resolveSearchProvider(): Promise<
  ((query: string) => Promise<SearchHit[]>) | undefined
> {
  const apiKey = await getSearchApiKey();
  if (!apiKey) return undefined;
  return (query: string) => {
    assertExternalCallAllowed('SerpAPI 웹 검색');
    return serpApiSearch(query, 3, apiKey);
  };
}
