/**
 * tools/index.ts — Strands `tool()` 어댑터 전용 모듈.
 *
 * design.md 원칙 6(프레임워크 중립 계약): 도구의 실제 로직은 `tools/catalog.ts`,
 * `tools/tastings.ts`, `tools/stats.ts`, `tools/web.ts` 의 순수 함수가 담당하고,
 * 이 파일은 Strands `tool()` 팩토리로 감싸는 얇은 바인딩만 한다.
 *
 * **R10 불변식 — LLM 에 노출되는 도구는 전부 읽기 전용이다.**
 * `test/tools-readonly.test.ts` 가 이 파일이 export 하는 도구 이름 목록을
 * `READONLY_TOOL_NAMES` 화이트리스트와 대조해 정적으로 검증한다. 새 도구를
 * 추가하면 반드시 그 테스트의 화이트리스트도 함께 갱신해야 한다 — 검증이
 * 저절로 통과하지 않도록, 이 파일에서 쓰기 계열 Repository 메서드
 * (put/patch/delete)를 import 하지 않는다.
 */
import { tool } from '@strands-agents/sdk';
import type { Repository } from '@app/db/repository';
import {
  ComputeStatsSpec,
  FindSimilarTastingsInput,
  FindWinesInput,
  GetRecentTastingsInput,
  GetTastingsForWineInput,
  GetWineInput,
  ListDiscoveriesInput,
  WebSearchInput,
} from '@waganda/schemas';
import { findWines, getWine } from './catalog.js';
import { computeStats } from './stats.js';
import {
  findSimilarTastings,
  getRecentTastings,
  getTastingsForWine,
  getTasteProfile,
  listDiscoveries,
} from './tastings.js';
import { webSearch, type WebSearchProvider } from './web.js';

/** 이 모듈이 생성하는 모든 도구 이름 — 정적 검증 테스트가 참조한다 */
export const READONLY_TOOL_NAMES = [
  'getWine',
  'findWines',
  'getTastingsForWine',
  'getRecentTastings',
  'findSimilarTastings',
  'getTasteProfile',
  'listDiscoveries',
  'computeStats',
  'webSearch',
] as const;

export interface BuildToolsOptions {
  repo: Repository;
  webSearchProvider?: WebSearchProvider;
}

/**
 * 에이전트에 주입할 Strands 도구 목록을 만든다.
 * 모든 콜백은 `catalog.ts`/`tastings.ts`/`stats.ts`/`web.ts` 의 읽기 전용
 * 함수만 호출하며, Repository 의 `put*`/`patch*`/`delete*` 메서드는 이
 * 클로저 안에서 절대 참조하지 않는다.
 */
export function buildReadonlyTools(options: BuildToolsOptions) {
  const catalogCtx = { repo: options.repo };
  const statsCtx = { repo: options.repo };
  const webCtx = { provider: options.webSearchProvider };

  return [
    tool({
      name: 'getWine',
      description: '와인 ID로 와인 상세(와이너리·지역 경로 포함)를 조회한다. 읽기 전용.',
      inputSchema: GetWineInput,
      callback: (input) => getWine(catalogCtx, input) as Promise<unknown>,
    }),
    tool({
      name: 'findWines',
      description: '이름·와이너리·지역·품종 부분일치로 와인을 찾는다 (최대 20건). 읽기 전용.',
      inputSchema: FindWinesInput,
      callback: (input) => findWines(catalogCtx, input),
    }),
    tool({
      name: 'getTastingsForWine',
      description: '특정 와인의 시음 이력을 시간순으로 조회한다. 읽기 전용.',
      inputSchema: GetTastingsForWineInput,
      callback: (input) => getTastingsForWine({ repo: options.repo }, input),
    }),
    tool({
      name: 'getRecentTastings',
      description: '최신순 시음 목록을 조회한다 (최대 20건). 읽기 전용.',
      inputSchema: GetRecentTastingsInput,
      callback: (input) => getRecentTastings({ repo: options.repo }, input),
    }),
    tool({
      name: 'findSimilarTastings',
      description: '품종·지역·5축 노트 유사도로 과거 시음을 찾는다 (최대 10건). 읽기 전용.',
      inputSchema: FindSimilarTastingsInput,
      callback: (input) => findSimilarTastings({ repo: options.repo }, input),
    }),
    tool({
      name: 'getTasteProfile',
      description: '현재 취향 프로파일을 조회한다 (비활성 상태 포함). 읽기 전용.',
      callback: () => getTasteProfile({ repo: options.repo }),
    }),
    tool({
      name: 'listDiscoveries',
      description: '발견 카드 목록을 조회한다. 읽기 전용.',
      inputSchema: ListDiscoveriesInput,
      callback: (input) => listDiscoveries({ repo: options.repo }, input),
    }),
    tool({
      name: 'computeStats',
      description:
        '제한된 스펙(ComputeStatsSpec)으로 그룹별 통계를 계산한다. 임의 코드·SQL 은 받지 않는다. 읽기 전용.',
      inputSchema: ComputeStatsSpec,
      callback: (input) => computeStats(statsCtx, input),
    }),
    tool({
      name: 'webSearch',
      description: '라벨 보강용 웹 검색. 결과와 출처 URL을 반환한다. 읽기 전용(외부 조회만).',
      inputSchema: WebSearchInput,
      callback: (input) => webSearch(webCtx, input),
    }),
  ];
}
