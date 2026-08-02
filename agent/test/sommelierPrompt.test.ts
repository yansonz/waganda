/**
 * agent/test/sommelierPrompt.test.ts
 *
 * 회귀 배경:
 * - 감정 타임라인이 화면에 항상 비어 있던 원인은 시스템 프롬프트의 산출 목록에
 *   emotionTimeline 자체가 빠져 있어(선택 필드로만 존재) 모델이 거의 만들지
 *   않았기 때문이다.
 * - 시음 상세의 "과거 대비 변화" 텍스트에 `\"19 Crimes\"` 처럼 리터럴 백슬래시가
 *   그대로 노출된 원인은 모델이 JSON 문자열 값 안에서 따옴표를 이스케이프
 *   문자로 직접 생성했기 때문이다. 프롬프트로 이를 명시적으로 금지한다.
 */
import { describe, expect, it } from 'vitest';
import { SOMMELIER_SYSTEM_PROMPT } from '../src/prompts/sommelier.js';

describe('소믈리에 시스템 프롬프트', () => {
  it('emotionTimeline 을 선택이 아닌 필수 산출 항목으로 지시한다', () => {
    expect(SOMMELIER_SYSTEM_PROMPT).toContain('emotionTimeline');
    expect(SOMMELIER_SYSTEM_PROMPT).toContain('선택 항목이 아니라');
  });

  it('문자열 값 안에 이스케이프 문자(백슬래시+따옴표)를 생성하지 말라고 지시한다', () => {
    expect(SOMMELIER_SYSTEM_PROMPT).toContain('이스케이프 문자');
    expect(SOMMELIER_SYSTEM_PROMPT).toContain('큰따옴표를 쓰지 않는다');
  });
});
