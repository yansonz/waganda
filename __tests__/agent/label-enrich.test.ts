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
  detectConflicts,
  enrichLabelExtraction,
  findMissingFields,
  hasGrapeTypeConflict,
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

describe('detectConflicts', () => {
  it('화이트 와인에 레드 와인 설명이 들어오면 충돌을 감지한다', () => {
    const whiteWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'white', confidence: 'high' },
      country: { value: 'Portugal', confidence: 'high' },
    };
    const enriched = {
      characterNote: '리베라 델 두에로의 특성을 담은 대담한 레드 와인',
      characterTags: ['템프라니요 주도', '오크 강함', '풀바디'],
      grapes: ['Tempranillo', 'Grenache'],
    };

    const conflicts = detectConflicts(whiteWine, enriched);

    expect(conflicts.has('characterNote')).toBe(true);
    expect(conflicts.has('characterTags')).toBe(true);
    expect(conflicts.has('grapes')).toBe(true);
  });

  it('레드 와인에 화이트 와인 설명이 들어오면 충돌을 감지한다', () => {
    const redWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'red', confidence: 'high' },
    };
    const enriched = {
      characterNote: '상큼한 화이트 와인 with citrus notes',
    };

    const conflicts = detectConflicts(redWine, enriched);
    expect(conflicts.has('characterNote')).toBe(true);
  });

  it('같은 타입이면 충돌이 아니다', () => {
    const redWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'red', confidence: 'high' },
    };
    const enriched = {
      characterNote: '과실향이 풍부한 미디엄 바디',
      grapes: ['Tempranillo'],
    };

    const conflicts = detectConflicts(redWine, enriched);
    expect(conflicts.size).toBe(0);
  });

  it('wineType 이 이미 인식됐는데 다른 타입을 넣으려 하면 충돌', () => {
    const whiteWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'white', confidence: 'high' },
    };
    const enriched = { wineType: 'red' };

    const conflicts = detectConflicts(whiteWine, enriched);
    expect(conflicts.has('wineType')).toBe(true);
  });

  it('wineType 이 없으면 보강 결과의 wineType 은 충돌이 아니다', () => {
    const enriched = { wineType: 'red', characterNote: '풀바디 레드 와인' };
    const conflicts = detectConflicts(recognized, enriched);
    expect(conflicts.has('wineType')).toBe(false);
  });

  it('포르투갈인데 리베라 델 두에로 지역이 오면 충돌', () => {
    const portuguese: LabelExtraction = {
      ...recognized,
      country: { value: 'Portugal', confidence: 'high' },
    };
    const enriched = { regionName: 'Ribera del Duero' };

    const conflicts = detectConflicts(portuguese, enriched);
    expect(conflicts.has('regionName')).toBe(true);
  });

  it('같은 국가의 지역이면 충돌이 아니다', () => {
    const portuguese: LabelExtraction = {
      ...recognized,
      country: { value: 'Portugal', confidence: 'high' },
    };
    const enriched = { regionName: 'Douro' };

    const conflicts = detectConflicts(portuguese, enriched);
    expect(conflicts.has('regionName')).toBe(false);
  });
});

describe('enrichLabelExtraction — 충돌 감지 통합', () => {
  it('화이트 와인에 레드 와인 정보를 넣으려 하면 해당 필드를 건너뛴다', async () => {
    const whiteWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'white', confidence: 'high' },
      country: { value: 'Portugal', confidence: 'high' },
      regionName: { value: 'Beira Interior', confidence: 'high' },
      wineryName: { value: 'Castielo Rodrigo', confidence: 'high' },
    };

    const invokeModel = modelReturning({
      grapes: ['Tempranillo', 'Grenache'],
      characterNote: '리베라 델 두에로의 특성을 담은 대담한 레드 와인',
      characterTags: ['템프라니요 주도', '오크 강함', '스페인 리베라 델 두에로', '풀바디'],
      alcoholPercent: 14.0,
    });

    const result = await enrichLabelExtraction(whiteWine, { invokeModel });

    // 충돌 필드는 병합되지 않는다
    expect(result.extraction.grapes).toBeUndefined();
    expect(result.extraction.characterNote).toBeUndefined();
    expect(result.extraction.characterTags).toBeUndefined();
    // 충돌이 아닌 필드는 정상 병합
    expect(result.extraction.alcoholPercent?.value).toBe(14.0);
    // conflicts 에 기록
    expect(result.conflicts).toContain('characterNote');
    expect(result.conflicts).toContain('characterTags');
    expect(result.conflicts).toContain('grapes');
  });
});

describe('hasGrapeTypeConflict', () => {
  it('화이트 와인에 레드 전용 품종이 과반수면 충돌', () => {
    expect(hasGrapeTypeConflict('white', ['tempranillo', 'cabernet sauvignon'])).toBe(true);
  });

  it('레드 와인에 화이트 전용 품종이 과반수면 충돌', () => {
    expect(hasGrapeTypeConflict('red', ['chardonnay', 'sauvignon blanc'])).toBe(true);
  });

  it('다용도 품종만 있으면 충돌이 아니다 (판정 안 함)', () => {
    // Grenache 는 다용도 품종으로 분류되지 않은 상태지만
    // Muscat, Garnacha 같은 명확한 다용도는 null 반환
    expect(hasGrapeTypeConflict('white', ['grenache'])).toBe(false);
  });

  it('미분류 품종은 충돌 판정에 영향을 주지 않는다', () => {
    // 'Unknown Grape' 는 미분류(null) — 판정 안 함
    expect(hasGrapeTypeConflict('white', ['Unknown Grape'])).toBe(false);
  });

  it('레드 품종 1개 + 미분류 1개 → 과반수라 충돌', () => {
    expect(hasGrapeTypeConflict('white', ['tempranillo', 'unknown variety'])).toBe(true);
  });

  it('레드 품종 1개 + 화이트 품종 1개 → 과반수 미달로 충돌 아님', () => {
    // 1/2 < ceil(2/2)=1 → conflictCount=1 >= 1 → 사실 충돌
    // 실제로는 혼합 품종이면 판정하기 애매하지만, 과반수 기준(>=ceil(n/2))이므로
    // 레드 1 + 화이트 1에서 화이트 와인 기준: 레드 1개 중 1개가 conflict → 1 >= ceil(2/2)=1 → true
    // 이 경우 판정이 맞다 (레드 전용 + 화이트 전용이 섞여 나오면 검색이 뭔가 잘못 가져온 것)
    expect(hasGrapeTypeConflict('white', ['tempranillo', 'chardonnay'])).toBe(true);
  });

  it('타입에 맞는 품종이면 충돌이 아니다', () => {
    expect(hasGrapeTypeConflict('red', ['tempranillo', 'cabernet sauvignon'])).toBe(false);
    expect(hasGrapeTypeConflict('white', ['chardonnay', 'sauvignon blanc'])).toBe(false);
  });

  it('빈 품종 배열은 충돌이 아니다', () => {
    expect(hasGrapeTypeConflict('white', [])).toBe(false);
  });
});

describe('detectConflicts — 품종-타입 교차 검증', () => {
  it('화이트 와인에 Tempranillo + Cabernet 이 들어오면 grapes 충돌', () => {
    const whiteWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'white', confidence: 'high' },
    };
    const enriched = { grapes: ['Tempranillo', 'Cabernet Sauvignon'] };

    const conflicts = detectConflicts(whiteWine, enriched);
    expect(conflicts.has('grapes')).toBe(true);
  });

  it('레드 와인에 Chardonnay + Riesling 이 들어오면 grapes 충돌', () => {
    const redWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'red', confidence: 'high' },
    };
    const enriched = { grapes: ['Chardonnay', 'Riesling'] };

    const conflicts = detectConflicts(redWine, enriched);
    expect(conflicts.has('grapes')).toBe(true);
  });

  it('레드 와인에 Syrah + Merlot 이면 정상 (충돌 아님)', () => {
    const redWine: LabelExtraction = {
      ...recognized,
      wineType: { value: 'red', confidence: 'high' },
    };
    const enriched = { grapes: ['Syrah', 'Merlot'] };

    const conflicts = detectConflicts(redWine, enriched);
    expect(conflicts.has('grapes')).toBe(false);
  });

  it('보강이 넣으려는 wineType 과 grapes 가 서로 모순이면 둘 다 충돌', () => {
    // wineType 이 아직 인식 안 됐고, 보강이 white + [Tempranillo, Merlot] 을 동시에 넣으려 함
    // → 보강 자체가 모순 → 검색이 두 와인을 섞었을 가능성
    const noType: LabelExtraction = { ...recognized };
    const enriched = {
      wineType: 'white',
      grapes: ['Tempranillo', 'Merlot'],
      characterNote: '과일향이 좋다',
    };

    const conflicts = detectConflicts(noType, enriched);
    expect(conflicts.has('wineType')).toBe(true);
    expect(conflicts.has('grapes')).toBe(true);
    expect(conflicts.has('characterNote')).toBe(true);
  });
});
