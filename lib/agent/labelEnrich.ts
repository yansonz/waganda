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
): Promise<{ extraction: LabelExtraction; filled: EnrichableField[]; usedSearch: boolean }> {
  const missing = findMissingFields(extraction);
  if (missing.length === 0 || !extraction.name?.value) {
    return { extraction, filled: [], usedSearch: false };
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
    return { extraction, filled: [], usedSearch: hits.length > 0 };
  }

  // 검색 근거가 있으면 medium, 자체 지식이면 low
  const confidence = hits.length > 0 ? ('medium' as const) : ('low' as const);
  const merged: LabelExtraction = { ...extraction };
  const filled: EnrichableField[] = [];

  for (const field of missing) {
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
    return { extraction, filled: [], usedSearch: hits.length > 0 };
  }

  return { extraction: parsed.data, filled, usedSearch: hits.length > 0 };
}
