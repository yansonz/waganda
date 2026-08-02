/**
 * __tests__/schemas/analysis-sanitize.test.ts
 *
 * 회귀 배경:
 * 1. 소믈리에 모델이 JSON 문자열 값 안에 리터럴 이스케이프(\")를 그대로 생성해
 *    시음 상세 화면의 "과거 대비 변화" 섹션에 `\"19 Crimes\"` 처럼 백슬래시가
 *    그대로 노출된 사고가 있었다.
 * 2. 이 정리를 처음에는 zod `.transform()` 으로 구현했는데, `SommelierOutput` 은
 *    Strands SDK 의 `structuredOutputSchema` 로도 쓰여 `z.toJSONSchema()` 가
 *    도구 입력 스키마를 생성한다. transform 이 붙은 스키마는 JSON Schema로
 *    표현할 수 없어 "Transforms cannot be represented in JSON Schema" 로 세션 B
 *    전체가 실패했다(배포 후 실제로 재현됨). 그래서 스키마는 순수 구조로 유지하고
 *    `sanitizeAnalysisText` 를 검증 통과 후 호출부에서 명시적으로 적용한다.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Analysis, SommelierOutput, sanitizeAnalysisText } from '@waganda/schemas';

const baseOutput = {
  summary: '산미가 도드라지는 화이트 와인이었다.',
  highlights: [{ quote: '와 신선하다', note: '산미에 대한 긍정적 반응' }],
  evidence: [{ field: 'summary', basis: '발화 인용', kind: 'quote' as const }],
};

describe('SommelierOutput/Analysis 스키마는 transform 을 쓰지 않는다 (JSON Schema 변환 회귀)', () => {
  it('SommelierOutput 은 z.toJSONSchema 로 변환 가능하다 (Strands structuredOutputSchema 계약)', () => {
    // StructuredOutputTool._buildSpec() 이 Agent 생성 시점에 이 변환을 호출한다.
    // transform 이 붙으면 여기서 예외가 나 세션 B 전체가 500 으로 실패한다.
    expect(() => z.toJSONSchema(SommelierOutput)).not.toThrow();
  });

  it('Analysis 도 z.toJSONSchema 로 변환 가능하다', () => {
    expect(() => z.toJSONSchema(Analysis)).not.toThrow();
  });
});

describe('sanitizeAnalysisText — 모델 출력 이스케이프 정리', () => {
  it('comparisonToPast 안의 리터럴 \\" 를 정상 인용부호로 정리한다', () => {
    const parsed = SommelierOutput.parse({
      ...baseOutput,
      comparisonToPast: String.raw`최근 시음 기록(\"19 Crimes\" 호주 시라즈, 평점 4.0)과 비교하면...`,
    });
    const sanitized = sanitizeAnalysisText(parsed);

    expect(sanitized.comparisonToPast).toBe('최근 시음 기록("19 Crimes" 호주 시라즈, 평점 4.0)과 비교하면...');
    expect(sanitized.comparisonToPast).not.toContain('\\');
  });

  it('speakerContrast·summary·highlights 에도 동일하게 적용된다', () => {
    const parsed = SommelierOutput.parse({
      ...baseOutput,
      summary: String.raw`\"바닐라\" 향이 먼저 올라온다고 했다.`,
      speakerContrast: String.raw`한쪽은 \"신선하다\"고 반응했다.`,
      highlights: [{ quote: '와 신선하다', note: String.raw`\"신선하다\" 반응` }],
    });
    const sanitized = sanitizeAnalysisText(parsed);

    expect(sanitized.summary).toBe('"바닐라" 향이 먼저 올라온다고 했다.');
    expect(sanitized.speakerContrast).toBe('한쪽은 "신선하다"고 반응했다.');
    expect(sanitized.highlights[0].note).toBe('"신선하다" 반응');
  });

  it('정상 텍스트는 그대로 통과한다 (부작용 없음)', () => {
    const parsed = SommelierOutput.parse(baseOutput);
    const sanitized = sanitizeAnalysisText(parsed);
    expect(sanitized.summary).toBe(baseOutput.summary);
    expect(sanitized.highlights[0].note).toBe(baseOutput.highlights[0].note);
  });

  it('필드가 없으면(optional) 그대로 undefined 를 유지한다', () => {
    const parsed = SommelierOutput.parse(baseOutput);
    const sanitized = sanitizeAnalysisText(parsed);
    expect(sanitized.comparisonToPast).toBeUndefined();
    expect(sanitized.speakerContrast).toBeUndefined();
  });
});

describe('Analysis — 저장 레코드 조회 시에도 이스케이프를 정리한다', () => {
  const now = new Date().toISOString();
  const baseAnalysis = {
    type: 'ANALYSIS' as const,
    tastingId: '11111111-1111-4111-8111-111111111111',
    summary: '기본 요약',
    highlights: [],
    evidence: [{ field: 'summary', basis: '근거', kind: 'quote' as const }],
    promptVersion: 'sommelier-v2',
    modelId: 'test-model',
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };

  it('과거에 오염된 채로 저장된 comparisonToPast 를 읽을 때 정리된다', () => {
    // DynamoDB 에 이미 저장돼 있던 오염 데이터를 흉내낸다. repository.getAnalysis 가
    // Analysis.parse 후 sanitizeAnalysisText 를 거치므로 화면에서 즉시 고쳐져야 한다.
    const parsed = Analysis.parse({
      ...baseAnalysis,
      comparisonToPast: String.raw`\"19 Crimes\" 대비 가벼운 스타일입니다.`,
    });
    const sanitized = sanitizeAnalysisText(parsed);

    expect(sanitized.comparisonToPast).toBe('"19 Crimes" 대비 가벼운 스타일입니다.');
  });

  it('editedSummary(편집자 수정본)에도 동일하게 적용된다', () => {
    const parsed = Analysis.parse({
      ...baseAnalysis,
      editedSummary: String.raw`\"수정된\" 요약입니다.`,
    });
    const sanitized = sanitizeAnalysisText(parsed);

    expect(sanitized.editedSummary).toBe('"수정된" 요약입니다.');
  });
});
