/**
 * 라벨 보강 테스트 (lib/agent/labelEnrich.ts).
 *
 * 라벨에 없는 품종·지역·도수를 채워 두어야 취향 분석·패턴 탐색의 축으로 쓸 수 있다(R3→R7/R8).
 * 다만 인식된 값을 덮어쓰지 않고, 출처 URL 을 만들어내지 않는 것이 중요하다.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LabelExtraction } from '@waganda/schemas';
import {
  buildSearchQuery,
  enrichLabelExtraction,
  findMissingFields,
} from '@/lib/agent/labelEnrich';

const recognized: LabelExtraction = {
  recognized: true,
  name: { value: '19 Crimes Shiraz', confidence: 'high' },
  vintage: { value: 2021, confidence: 'medium' },
  sourceUrls: [],
};

function modelReturning(payload: unknown) {
  return vi.fn(async () => JSON.stringify(payload));
}

describe('findMissingFields', () => {
  it('비어 있는 보강 대상만 찾는다', () => {
    expect(findMissingFields(recognized)).toEqual([
      'country',
      'regionName',
      'wineryName',
      'grapes',
      'wineType',
      'alcoholPercent',
      'characterTags',
      'characterNote',
    ]);
  });

  it('이미 인식된 필드는 대상이 아니다', () => {
    const withCountry: LabelExtraction = {
      ...recognized,
      country: { value: '호주', confidence: 'high' },
      grapes: { value: ['Shiraz'], confidence: 'high' },
    };
    expect(findMissingFields(withCountry)).toEqual([
      'regionName',
      'wineryName',
      'wineType',
      'alcoholPercent',
      'characterTags',
      'characterNote',
    ]);
  });
});

describe('buildSearchQuery', () => {
  it('이름·빈티지·와이너리를 조합한다', () => {
    const query = buildSearchQuery({
      ...recognized,
      wineryName: { value: 'Treasury Wine Estates', confidence: 'low' },
    });
    expect(query).toContain('19 Crimes Shiraz');
    expect(query).toContain('2021');
    expect(query).toContain('Treasury Wine Estates');
  });
});

describe('enrichLabelExtraction', () => {
  it('빈 필드를 채우고 어떤 필드를 채웠는지 알려준다', async () => {
    const invokeModel = modelReturning({
      country: '호주',
      grapes: ['Shiraz'],
      wineType: 'red',
      alcoholPercent: 14.5,
    });

    const result = await enrichLabelExtraction(recognized, { invokeModel });

    expect(result.filled).toEqual(['country', 'grapes', 'wineType', 'alcoholPercent']);
    expect(result.extraction.country?.value).toBe('호주');
    expect(result.extraction.grapes?.value).toEqual(['Shiraz']);
    expect(result.extraction.wineType?.value).toBe('red');
    expect(result.extraction.alcoholPercent?.value).toBe(14.5);
  });

  it('검색 근거 없이 채운 값은 confidence low 로 표시한다', async () => {
    const invokeModel = modelReturning({ country: '호주' });
    const result = await enrichLabelExtraction(recognized, { invokeModel });
    expect(result.extraction.country?.confidence).toBe('low');
    expect(result.usedSearch).toBe(false);
  });

  it('검색 근거가 있으면 medium 으로 올리고 출처를 기록한다', async () => {
    const invokeModel = modelReturning({ country: '호주', grapes: ['Shiraz'] });
    const search = vi.fn(async () => [
      { title: '19 Crimes', snippet: 'Australian wine brand', url: 'https://example.com/19crimes' },
    ]);

    const result = await enrichLabelExtraction(recognized, { invokeModel, search });

    expect(result.usedSearch).toBe(true);
    expect(result.extraction.country?.confidence).toBe('medium');
    expect(result.extraction.sourceUrls).toEqual(['https://example.com/19crimes']);
  });

  it('모델이 만든 URL 은 출처로 받지 않는다 (환각 방지)', async () => {
    const invokeModel = modelReturning({
      country: '호주',
      sourceUrls: ['https://fake.example.com/made-up'],
    });

    const result = await enrichLabelExtraction(recognized, { invokeModel });
    expect(result.extraction.sourceUrls).toEqual([]);
  });

  it('인식된 값을 덮어쓰지 않는다', async () => {
    const withCountry: LabelExtraction = {
      ...recognized,
      country: { value: '프랑스', confidence: 'high' },
    };
    const invokeModel = modelReturning({ country: '호주', grapes: ['Shiraz'] });

    const result = await enrichLabelExtraction(withCountry, { invokeModel });
    expect(result.extraction.country).toEqual({ value: '프랑스', confidence: 'high' });
    expect(result.filled).not.toContain('country');
  });

  it('채울 것이 없으면 모델을 호출하지 않는다', async () => {
    const invokeModel = vi.fn();
    const full: LabelExtraction = {
      ...recognized,
      country: { value: '호주', confidence: 'high' },
      regionName: { value: 'South Australia', confidence: 'high' },
      wineryName: { value: '19 Crimes', confidence: 'high' },
      grapes: { value: ['Shiraz'], confidence: 'high' },
      wineType: { value: 'red', confidence: 'high' },
      alcoholPercent: { value: 14, confidence: 'high' },
      characterTags: { value: ['과실향 강함'], confidence: 'low' },
      characterNote: { value: '대중적인 호주 시라즈', confidence: 'low' },
    };

    const result = await enrichLabelExtraction(full, { invokeModel });
    expect(invokeModel).not.toHaveBeenCalled();
    expect(result.filled).toEqual([]);
  });

  it('잘못된 값(범위 초과·미지원 종류)은 버린다', async () => {
    const invokeModel = modelReturning({
      alcoholPercent: 99,
      wineType: 'orange',
      grapes: [],
    });

    const result = await enrichLabelExtraction(recognized, { invokeModel });
    expect(result.extraction.alcoholPercent).toBeUndefined();
    expect(result.extraction.wineType).toBeUndefined();
    expect(result.extraction.grapes).toBeUndefined();
    expect(result.filled).toEqual([]);
  });

  it('모델 호출이 실패하면 원본을 그대로 돌려준다 (보강은 최선 노력)', async () => {
    const invokeModel = vi.fn(async () => {
      throw new Error('bedrock down');
    });

    const result = await enrichLabelExtraction(recognized, { invokeModel });
    expect(result.extraction).toEqual(recognized);
    expect(result.filled).toEqual([]);
  });

  it('검색이 실패해도 모델 지식으로 계속한다', async () => {
    const invokeModel = modelReturning({ country: '호주' });
    const search = vi.fn(async () => {
      throw new Error('search down');
    });

    const result = await enrichLabelExtraction(recognized, { invokeModel, search });
    expect(result.extraction.country?.value).toBe('호주');
    expect(result.usedSearch).toBe(false);
  });
});
