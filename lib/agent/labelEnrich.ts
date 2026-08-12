import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { LabelExtraction, WineType } from '@waganda/schemas';
import { getRuntimeConfig } from '@/lib/config';
import { assertExternalCallAllowed } from '@/lib/aws/testGuard';

/**
 * lib/agent/labelEnrich.ts — 라벨 인식 결과 보강 (R3).
 *
 * 라벨에는 품종·지역·도수가 적혀 있지 않은 경우가 많다.
 * 그런 필드가 비어 있으면 외부 정보로 채워 두어야 나중에 취향 분석(R7)·패턴 탐색(R8)의
 * 축으로 쓸 수 있다. 비어 있는 채로 저장하면 그 시음은 통계에서 빠진다.
 *
 * 보강 순서
 * 1. 비어 있는 필드를 찾는다. 없으면 아무 것도 하지 않는다(호출 절약).
 * 2. 검색 프로바이더가 설정돼 있으면 검색하고, 그 결과를 모델에 근거로 준다.
 * 3. 검색이 없으면 모델의 자체 지식으로만 채우게 하고 **확신 없는 필드는 비우도록** 지시한다.
 *
 * 원칙
 * - 인식된 값을 덮어쓰지 않는다. 빈 필드만 채운다.
 * - 검색 결과가 근거인 필드는 `medium`, 모델 지식만인 필드는 `low` 로 표시한다.
 * - **출처 URL 은 실제 검색 결과에서만 가져온다.** 모델이 URL 을 만들어도 버린다(환각 방지).
 */

const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

/** 보강 대상 필드 */
const ENRICHABLE_FIELDS = [
  'country',
  'regionName',
  // 라벨에 생산자 표기가 없거나 못 읽은 경우가 많다 — 화면의 "와이너리" 줄을 채우는 값이다
  'wineryName',
  'grapes',
  'wineType',
  'alcoholPercent',
  // 검색·지식으로 알게 된 특징을 버리지 않고 태그·한 줄 노트로 남긴다 (R8 탐색 축)
  'characterTags',
  'characterNote',
] as const;
type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
}

export interface EnrichDeps {
  /** 웹 검색 (미설정이면 모델 지식만 사용) */
  search?: (query: string) => Promise<SearchHit[]>;
  invokeModel: (input: { prompt: string; system: string }) => Promise<string>;
}

/** 비어 있는 보강 대상 필드 목록 */
export function findMissingFields(extraction: LabelExtraction): EnrichableField[] {
  return ENRICHABLE_FIELDS.filter((field) => extraction[field] === undefined);
}

/** 검색 질의문 — 이름·빈티지·와이너리를 조합한다 */
export function buildSearchQuery(extraction: LabelExtraction): string {
  return [
    extraction.name?.value,
    extraction.vintage?.value ? String(extraction.vintage.value) : undefined,
    extraction.wineryName?.value,
    'wine grape variety region',
  ]
    .filter(Boolean)
    .join(' ');
}

const SYSTEM_PROMPT = `당신은 와인 참조 정보를 정리하는 도구입니다.

주어진 와인에 대해 **비어 있는 필드만** 채웁니다. JSON 하나만 반환하세요(코드펜스 금지).

{
  "country": "호주",
  "regionName": "South Australia",
  "wineryName": "19 Crimes",
  "grapes": ["Shiraz"],
  "wineType": "red",
  "alcoholPercent": 14.5,
  "characterTags": ["과실향 강함", "부드러운 타닌", "대중적", "호주 시라즈"],
  "characterNote": "잘 익은 검은 과실과 바닐라 오크가 두드러지는 대중적인 호주 시라즈"
}

규칙:
- **확실하지 않은 필드는 키 자체를 넣지 마세요.** 추측·평균값·"아마도"는 금지입니다.
- wineType 은 red | white | rose | sparkling | dessert | fortified 중 하나입니다.
- wineryName 은 생산자(브랜드) 이름입니다. 와인 이름과 같다면 같게 적으세요.
- grapes 는 품종명 영문 표기 배열입니다.
- 근거 자료가 주어졌다면 그 안에서만 읽어 채우세요. 자료에 없으면 자체 지식으로 채워도 되지만,
  확실한 것만 넣으세요.
- URL 을 만들어 넣지 마세요. 출처는 시스템이 따로 관리합니다.
- **characterTags 는 3~8개**, 나중에 "이런 특징의 와인을 좋아하더라" 를 찾는 데 쓸 축입니다.
  스타일·품종·산지 성격·가격대 인상처럼 **비교 가능한 특징**을 적으세요.
  좋은 예: "과실향 강함", "오크 강함", "높은 산도", "대중적", "호주 시라즈", "가성비"
  나쁜 예: "맛있음", "좋은 와인"(주관적), "와인"(정보 없음), 라벨 디자인(그건 별도로 다룹니다)
- characterNote 는 한 문장입니다.`;

function defaultInvokeModel(): EnrichDeps['invokeModel'] {
  return async ({ prompt, system }) => {
    assertExternalCallAllowed('Bedrock 라벨 보강');
    const config = getRuntimeConfig();
    const client = new BedrockRuntimeClient({ region: config.region });
    const modelId = process.env.WAGANDA_BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;

    const result = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 600, temperature: 0 },
      }),
    );

    const text = result.output?.message?.content?.find((block) => block.text)?.text;
    if (!text) throw new Error('모델이 텍스트를 반환하지 않았습니다.');
    return text;
  };
}

/**
 * 웹검색 보강 결과와 라벨 인식 결과 사이의 충돌을 감지한다.
 *
 * 검색이 전혀 다른 와인의 정보를 가져오는 경우(예: 포르투갈 화이트 와인인데
 * 스페인 레드 와인 정보가 들어오는 경우)를 잡아 해당 필드를 병합하지 않는다.
 *
 * 충돌 규칙:
 * - wineType 이 이미 인식됐는데 보강이 다른 타입 계열의 특징을 넣으려 하면 충돌
 * - country 가 인식됐는데 보강이 완전히 다른 국가의 지역을 넣으려 하면 충돌
 * - characterNote/characterTags 가 인식된 wineType 과 모순되면 충돌
 */
export function detectConflicts(
  extraction: LabelExtraction,
  enriched: Record<string, unknown>,
): Set<EnrichableField> {
  const conflicting = new Set<EnrichableField>();

  const knownType = extraction.wineType?.value;

  // 규칙 1: 보강이 넣으려는 wineType 이 인식된 타입과 다르면 충돌
  if (knownType && enriched.wineType && String(enriched.wineType) !== knownType) {
    conflicting.add('wineType');
  }

  // 규칙 2: characterNote 가 인식된 wineType 과 모순되면 충돌
  // "레드 와인" 계열 키워드가 화이트 와인에 들어가거나 그 반대
  if (knownType && enriched.characterNote) {
    const note = String(enriched.characterNote).toLowerCase();
    if (hasTypeConflictInText(knownType, note)) {
      conflicting.add('characterNote');
      // characterNote 가 충돌이면 같은 검색 근거에서 나온 characterTags, grapes 도 의심
      conflicting.add('characterTags');
      conflicting.add('grapes');
    }
  }

  // 규칙 3: characterTags 에 모순되는 타입 키워드가 포함되면 충돌
  if (knownType && Array.isArray(enriched.characterTags)) {
    const tags = enriched.characterTags.map((t) => String(t).toLowerCase());
    if (tags.some((tag) => hasTypeConflictInText(knownType, tag))) {
      conflicting.add('characterTags');
      conflicting.add('grapes');
    }
  }

  // 규칙 4: country 가 인식됐는데 regionName 이 다른 국가의 지역을 가리키면 충돌
  const knownCountry = extraction.country?.value;
  if (knownCountry && enriched.regionName) {
    const region = String(enriched.regionName).toLowerCase();
    if (isKnownForeignRegion(knownCountry, region)) {
      conflicting.add('regionName');
    }
  }

  // 규칙 5: 인식된 wineType 과 보강 grapes 사이의 교차 검증
  // 명백히 레드 전용인 품종이 화이트 와인에 들어오거나 그 반대면 충돌
  if (knownType && Array.isArray(enriched.grapes) && enriched.grapes.length > 0) {
    const grapes = enriched.grapes.map((g) => String(g).toLowerCase());
    if (hasGrapeTypeConflict(knownType, grapes)) {
      conflicting.add('grapes');
    }
  }

  // 규칙 6: 보강이 넣으려는 grapes 와 보강이 넣으려는 wineType 이 모순되면
  // 검색이 여러 와인을 섞어놓았을 가능성 — 둘 다 의심
  if (
    enriched.wineType &&
    Array.isArray(enriched.grapes) &&
    enriched.grapes.length > 0 &&
    !conflicting.has('wineType')
  ) {
    const enrichedType = String(enriched.wineType);
    const grapes = enriched.grapes.map((g) => String(g).toLowerCase());
    if (hasGrapeTypeConflict(enrichedType, grapes)) {
      conflicting.add('grapes');
      conflicting.add('wineType');
      conflicting.add('characterNote');
      conflicting.add('characterTags');
    }
  }

  return conflicting;
}

/** 인식된 와인 타입과 텍스트 사이에 모순이 있는지 확인 */
function hasTypeConflictInText(knownType: string, text: string): boolean {
  const RED_KEYWORDS = ['레드 와인', 'red wine', '레드와인', '풀바디 레드', 'bold red'];
  const WHITE_KEYWORDS = ['화이트 와인', 'white wine', '화이트와인', '상큼한 화이트'];
  const ROSE_KEYWORDS = ['로제 와인', 'rosé wine', 'rose wine'];

  if (knownType === 'white') {
    return [...RED_KEYWORDS, ...ROSE_KEYWORDS].some((kw) => text.includes(kw));
  }
  if (knownType === 'red') {
    return [...WHITE_KEYWORDS, ...ROSE_KEYWORDS].some((kw) => text.includes(kw));
  }
  if (knownType === 'rose') {
    return [...RED_KEYWORDS, ...WHITE_KEYWORDS].some((kw) => text.includes(kw));
  }
  return false;
}

/**
 * 품종-타입 교차 검증.
 *
 * 거의 항상 레드인 품종이 화이트 와인에 들어오거나, 거의 항상 화이트인 품종이
 * 레드 와인에 들어오면 충돌. 다만 다용도 품종(Muscat, Grenache 등)은 판정하지 않는다.
 *
 * 판정 기준: 보강이 넣으려는 품종의 **과반수** 가 명백히 다른 타입이면 충돌.
 * 한두 개 다용도 품종이 섞여 있어도 주력 품종이 일치하면 통과.
 */
export function hasGrapeTypeConflict(wineType: string, grapes: string[]): boolean {
  if (grapes.length === 0) return false;

  let conflictCount = 0;
  for (const grape of grapes) {
    const grapeType = getGrapePrimaryType(grape);
    if (!grapeType) continue; // 다용도 또는 미분류 — 판정 안 함
    if (grapeType !== wineType) conflictCount++;
  }

  // 과반수가 충돌하면 다른 와인의 정보로 판정
  return conflictCount > 0 && conflictCount >= Math.ceil(grapes.length / 2);
}

/** 품종의 주력 타입을 반환한다. 다용도 품종은 null (판정 안 함). */
function getGrapePrimaryType(grape: string): string | null {
  // 거의 항상 레드인 품종
  const RED_GRAPES = [
    'tempranillo', 'cabernet sauvignon', 'merlot', 'pinot noir', 'syrah', 'shiraz',
    'malbec', 'sangiovese', 'nebbiolo', 'zinfandel', 'primitivo', 'mourvèdre',
    'mourvedre', 'carménère', 'carmenere', 'petit verdot', 'touriga nacional',
    'touriga franca', 'barbera', 'dolcetto', 'montepulciano', 'aglianico',
    'nero d\'avola', 'pinotage', 'tannat', 'carignan', 'gamay',
    'cabernet franc', 'graciano', 'mencía', 'mencia',
  ];

  // 거의 항상 화이트인 품종
  const WHITE_GRAPES = [
    'chardonnay', 'sauvignon blanc', 'riesling', 'pinot grigio', 'pinot gris',
    'gewürztraminer', 'gewurztraminer', 'viognier', 'albariño', 'albarino',
    'vermentino', 'trebbiano', 'cortese', 'grüner veltliner', 'gruner veltliner',
    'chenin blanc', 'sémillon', 'semillon', 'marsanne', 'roussanne',
    'torrontés', 'torrontes', 'verdejo', 'godello', 'fiano',
    'garganega', 'arneis', 'pecorino', 'verdicchio', 'müller-thurgau',
    'muller thurgau', 'silvaner', 'melon de bourgogne',
  ];

  // 다용도 품종 — 레드로도 화이트로도 만들어지는 품종은 판정하지 않는다
  // Grenache/Garnacha → rosé 가 많고, Muscat → 디저트/스파클링도 흔함
  // Pinot Meunier → 주로 스파클링(블랑 드 누아)

  const normalized = grape.toLowerCase().trim();
  if (RED_GRAPES.some((rg) => normalized.includes(rg))) return 'red';
  if (WHITE_GRAPES.some((wg) => normalized.includes(wg))) return 'white';
  return null; // 미분류 또는 다용도
}

/** 알려진 국가-지역 불일치를 감지한다 (주요 산지 대비) */
function isKnownForeignRegion(country: string, region: string): boolean {
  const SPAIN_REGIONS = ['rioja', 'ribera del duero', 'priorat', 'rías baixas', 'cava'];
  const FRANCE_REGIONS = ['bordeaux', 'bourgogne', 'burgundy', 'champagne', 'rhône', 'loire'];
  const ITALY_REGIONS = ['toscana', 'tuscany', 'piemonte', 'piedmont', 'veneto', 'sicilia'];

  const countryLower = country.toLowerCase();

  // 포르투갈인데 스페인 지역이 나오면 충돌
  if (countryLower.includes('portugal') || countryLower.includes('포르투갈')) {
    if (SPAIN_REGIONS.some((r) => region.includes(r))) return true;
    if (FRANCE_REGIONS.some((r) => region.includes(r))) return true;
    if (ITALY_REGIONS.some((r) => region.includes(r))) return true;
  }
  if (countryLower.includes('spain') || countryLower.includes('스페인')) {
    if (FRANCE_REGIONS.some((r) => region.includes(r))) return true;
    if (ITALY_REGIONS.some((r) => region.includes(r))) return true;
  }
  if (countryLower.includes('france') || countryLower.includes('프랑스')) {
    if (SPAIN_REGIONS.some((r) => region.includes(r))) return true;
    if (ITALY_REGIONS.some((r) => region.includes(r))) return true;
  }

  return false;
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('응답에서 JSON 을 찾지 못했습니다.');
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * 비어 있는 필드를 채운다. 실패하면 원본을 그대로 돌려준다(보강은 최선 노력).
 */
export async function enrichLabelExtraction(
  extraction: LabelExtraction,
  deps?: Partial<EnrichDeps>,
): Promise<{ extraction: LabelExtraction; filled: EnrichableField[]; usedSearch: boolean; conflicts: EnrichableField[] }> {
  const missing = findMissingFields(extraction);
  if (missing.length === 0 || !extraction.name?.value) {
    return { extraction, filled: [], usedSearch: false, conflicts: [] };
  }

  const invokeModel = deps?.invokeModel ?? defaultInvokeModel();
  const search = deps?.search;

  let hits: SearchHit[] = [];
  if (search) {
    try {
      hits = await search(buildSearchQuery(extraction));
    } catch {
      hits = [];
    }
  }

  const wineLine = [
    extraction.name.value,
    extraction.vintage?.value ? String(extraction.vintage.value) : undefined,
    extraction.wineryName?.value ? `(${extraction.wineryName.value})` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  const prompt = [
    `와인: ${wineLine}`,
    `채워야 할 필드: ${missing.join(', ')}`,
    '',
    hits.length > 0
      ? `근거 자료:\n${hits.map((h) => `- ${h.title}: ${h.snippet}`).join('\n')}`
      : '근거 자료: (없음 — 자체 지식으로 확실한 것만 채우세요)',
  ].join('\n');

  let filledRaw: Record<string, unknown>;
  try {
    filledRaw = extractJson(await invokeModel({ prompt, system: SYSTEM_PROMPT }));
  } catch {
    return { extraction, filled: [], usedSearch: hits.length > 0, conflicts: [] };
  }

  // 검색 근거가 있으면 medium, 자체 지식이면 low
  const confidence = hits.length > 0 ? ('medium' as const) : ('low' as const);
  const merged: LabelExtraction = { ...extraction };
  const filled: EnrichableField[] = [];

  // 충돌 감지: 웹검색이 다른 와인의 정보를 가져왔는지 확인
  const conflicts = detectConflicts(extraction, filledRaw);

  for (const field of missing) {
    // 충돌이 감지된 필드는 건너뛴다
    if (conflicts.has(field)) continue;
    const value = filledRaw[field];
    if (value === undefined || value === null || value === '') continue;

    if (field === 'grapes') {
      if (!Array.isArray(value) || value.length === 0) continue;
      merged.grapes = { value: value.map(String).slice(0, 12), confidence };
    } else if (field === 'alcoholPercent') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 30) continue;
      merged.alcoholPercent = { value: parsed, confidence };
    } else if (field === 'characterTags') {
      if (!Array.isArray(value) || value.length === 0) continue;
      merged.characterTags = { value: value.map(String).slice(0, 15), confidence };
    } else if (field === 'characterNote') {
      const note = String(value).trim();
      if (note.length === 0) continue;
      merged.characterNote = { value: note.slice(0, 500), confidence };
    } else if (field === 'wineType') {
      const parsed = WineType.safeParse(String(value));
      if (!parsed.success) continue;
      merged.wineType = { value: parsed.data, confidence };
    } else {
      merged[field] = { value: String(value), confidence };
    }
    filled.push(field);
  }

  // 출처는 실제 검색 결과에서만 (모델이 만든 URL 은 받지 않는다)
  if (filled.length > 0 && hits.length > 0) {
    const urls = hits.map((h) => h.url).filter((url) => /^https?:\/\//.test(url));
    merged.sourceUrls = [...new Set([...(extraction.sourceUrls ?? []), ...urls])].slice(0, 10);
  }

  // 병합 결과가 계약을 지키는지 확인 — 어기면 원본을 쓴다
  const parsed = LabelExtraction.safeParse(merged);
  if (!parsed.success) {
    return { extraction, filled: [], usedSearch: hits.length > 0, conflicts: [...conflicts] };
  }

  return { extraction: parsed.data, filled, usedSearch: hits.length > 0, conflicts: [...conflicts] };
}
