/**
 * packages/schemas/src/sanitize.ts — 모델 출력 텍스트 방어적 정리.
 *
 * 배경: Bedrock/Claude 가 JSON 문자열 값 안에 리터럴 이스케이프(`\"`, `\\`)를 그대로
 * 생성해 시음 상세의 "과거 대비 변화" 텍스트에 `\"19 Crimes\"` 처럼 백슬래시가 그대로
 * 노출된 사고가 있었다.
 *
 * 이 정리를 zod 스키마의 `.transform()` 으로 구현하면 안 된다 — `SommelierOutput` 은
 * Strands SDK 의 `structuredOutputSchema` 로 쓰여 `z.toJSONSchema()` 가 도구 입력
 * 스키마를 생성하는데, transform 이 붙은 스키마는 JSON Schema로 표현할 수 없어
 * "Transforms cannot be represented in JSON Schema" 로 세션 B 전체가 실패한다
 * (실제로 배포 후 재현됨). 그래서 스키마는 순수 구조로 유지하고, 검증 통과 후
 * 호출부에서 이 함수를 명시적으로 적용한다.
 */

/** 정상적인 한국어 문장에는 나타나지 않는 리터럴 이스케이프 패턴을 정리한다 */
export function sanitizeModelText(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

/** SommelierOutput/Analysis 의 사용자 노출 문자열 필드에 sanitizeModelText 를 적용한다 */
export function sanitizeAnalysisText<
  T extends {
    summary?: string;
    speakerContrast?: string;
    comparisonToPast?: string;
    editedSummary?: string;
    highlights?: { quote: string; note: string }[];
    editedHighlights?: { quote: string; note: string }[];
  },
>(value: T): T {
  return {
    ...value,
    summary: value.summary !== undefined ? sanitizeModelText(value.summary) : value.summary,
    speakerContrast:
      value.speakerContrast !== undefined
        ? sanitizeModelText(value.speakerContrast)
        : value.speakerContrast,
    comparisonToPast:
      value.comparisonToPast !== undefined
        ? sanitizeModelText(value.comparisonToPast)
        : value.comparisonToPast,
    editedSummary:
      value.editedSummary !== undefined
        ? sanitizeModelText(value.editedSummary)
        : value.editedSummary,
    highlights: value.highlights?.map((h) => ({
      ...h,
      quote: sanitizeModelText(h.quote),
      note: sanitizeModelText(h.note),
    })),
    editedHighlights: value.editedHighlights?.map((h) => ({
      ...h,
      quote: sanitizeModelText(h.quote),
      note: sanitizeModelText(h.note),
    })),
  };
}
