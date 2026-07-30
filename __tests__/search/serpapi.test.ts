/**
 * SerpAPI 검색 프로바이더 테스트.
 *
 * 무료 티어(월 100회)를 쓰므로 **캐시로 호출을 아끼는 것**과
 * 실패해도 보강 흐름을 막지 않는 것이 핵심이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSearchCache,
  getSearchProvider,
  parseSerpApiResponse,
  serpApiSearch,
} from '@/lib/search/serpapi';

const ORIGINAL_KEY = process.env.SERPAPI_KEY;

beforeEach(() => {
  clearSearchCache();
  process.env.SERPAPI_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIGINAL_KEY === undefined) delete process.env.SERPAPI_KEY;
  else process.env.SERPAPI_KEY = ORIGINAL_KEY;
});

function stubResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('parseSerpApiResponse', () => {
  it('organic_results 를 제목·요약·URL 로 변환한다', () => {
    const hits = parseSerpApiResponse({
      organic_results: [
        { title: '19 Crimes', snippet: 'Australian wine brand', link: 'https://example.com/a' },
        { title: 'Shiraz', snippet: 'grape variety', link: 'https://example.com/b' },
      ],
    });

    expect(hits).toEqual([
      { title: '19 Crimes', snippet: 'Australian wine brand', url: 'https://example.com/a' },
      { title: 'Shiraz', snippet: 'grape variety', url: 'https://example.com/b' },
    ]);
  });

  it('지식 패널이 있으면 가장 앞에 둔다', () => {
    const hits = parseSerpApiResponse({
      knowledge_graph: {
        title: '19 Crimes',
        description: 'Wine brand from Australia',
        website: 'https://19crimes.com',
      },
      organic_results: [{ title: '기타', snippet: 's', link: 'https://example.com/a' }],
    });

    expect(hits[0]).toEqual({
      title: '19 Crimes',
      snippet: 'Wine brand from Australia',
      url: 'https://19crimes.com',
    });
  });

  it('http(s) 가 아닌 링크는 버린다', () => {
    const hits = parseSerpApiResponse({
      organic_results: [
        { title: '나쁜 링크', snippet: 's', link: 'javascript:alert(1)' },
        { title: '좋은 링크', snippet: 's', link: 'https://example.com/ok' },
      ],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('https://example.com/ok');
  });

  it('limit 을 넘지 않는다', () => {
    const hits = parseSerpApiResponse(
      {
        organic_results: Array.from({ length: 8 }, (_, i) => ({
          title: `t${i}`,
          snippet: 's',
          link: `https://example.com/${i}`,
        })),
      },
      3,
    );
    expect(hits).toHaveLength(3);
  });
});

describe('serpApiSearch', () => {
  it('키가 없으면 호출하지 않고 빈 결과를 돌려준다', async () => {
    delete process.env.SERPAPI_KEY;
    const fetchMock = stubResponse({});

    expect(await serpApiSearch('19 Crimes')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('같은 질의는 캐시로 재사용한다 (무료 티어 절약)', async () => {
    const fetchMock = stubResponse({
      organic_results: [{ title: 'a', snippet: 's', link: 'https://example.com/a' }],
    });

    await serpApiSearch('19 Crimes');
    await serpApiSearch('19 Crimes');
    await serpApiSearch('19 Crimes');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('다른 질의는 새로 호출한다', async () => {
    const fetchMock = stubResponse({
      organic_results: [{ title: 'a', snippet: 's', link: 'https://example.com/a' }],
    });

    await serpApiSearch('19 Crimes');
    await serpApiSearch('Château Margaux');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('API 키를 질의 문자열에 담아 보낸다', async () => {
    const fetchMock = stubResponse({ organic_results: [] });
    await serpApiSearch('테스트 와인');

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.host).toBe('serpapi.com');
    expect(requested.pathname).toBe('/search.json');
    expect(requested.searchParams.get('api_key')).toBe('test-key');
    expect(requested.searchParams.get('q')).toBe('테스트 와인');
    expect(requested.searchParams.get('engine')).toBe('google');
  });

  it('오류 응답이면 빈 결과 (보강 흐름을 막지 않는다)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubResponse({ error: 'Invalid API key' }, 200);

    expect(await serpApiSearch('19 Crimes')).toEqual([]);
    warn.mockRestore();
  });

  it('HTTP 오류도 빈 결과로 처리한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubResponse({}, 429);

    expect(await serpApiSearch('19 Crimes')).toEqual([]);
    warn.mockRestore();
  });

  it('네트워크 실패도 빈 결과로 처리한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    expect(await serpApiSearch('19 Crimes')).toEqual([]);
    warn.mockRestore();
  });
});

describe('getSearchProvider', () => {
  it('키가 있으면 프로바이더를 돌려준다', () => {
    expect(getSearchProvider()).toBeTypeOf('function');
  });

  it('키가 없으면 undefined (모델 지식만 사용)', () => {
    delete process.env.SERPAPI_KEY;
    expect(getSearchProvider()).toBeUndefined();
  });
});
