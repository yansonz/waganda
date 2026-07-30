/**
 * tools/web.ts — webSearch 도구. 라벨 인식 보강용, 읽기 전용(외부 API 조회만).
 *
 * 실제 검색 프로바이더는 주입 가능하게 한다 — 테스트에서 스텁으로 대체하고,
 * 배포 환경에서는 구체 구현(예: 서드파티 검색 API)을 연결한다. 이 파일은
 * 프로바이더 계약과 얇은 기본 구현만 정의한다.
 */
import type { WebSearchInput, WebSearchResult } from '@waganda/schemas';

/** webSearch 가 위임하는 실제 검색 수행자 — 순수 함수로 주입 가능하게 한다 */
export type WebSearchProvider = (query: string, limit: number) => Promise<WebSearchResult['results']>;

/** 프로바이더 미설정 시 사용하는 기본 구현 — 항상 빈 결과를 반환한다(안전한 기본값) */
const noopProvider: WebSearchProvider = async () => [];

export interface WebSearchContext {
  provider?: WebSearchProvider;
}

/** query 로 웹 검색을 수행하고 결과 요약과 출처 URL을 반환한다 */
export async function webSearch(
  ctx: WebSearchContext,
  input: WebSearchInput,
): Promise<WebSearchResult> {
  const provider = ctx.provider ?? noopProvider;
  const results = await provider(input.query, input.limit);
  return { results: results.slice(0, input.limit) };
}
