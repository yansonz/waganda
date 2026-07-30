/**
 * 라벨 인식 직접 호출 경로 테스트 (lib/agent/labelDirect.ts).
 *
 * AgentCore 가 배포되지 않은 환경에서도 같은 `LabelExtraction` 계약을 지켜야 한다.
 * 모델 응답이 형식을 어기면 재생성하고, 끝까지 실패하면 인식 실패로 돌려준다(R6 과 동일 정책).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  isDirectLabelFallbackEnabled,
  recognizeLabelWithBedrock,
} from '@/lib/agent/labelDirect';

const VALID_JSON = JSON.stringify({
  recognized: true,
  name: { value: '19 Crimes', confidence: 'high' },
  country: { value: 'Australia', confidence: 'medium' },
  sourceUrls: [],
});

interface InvokeInput {
  image: Uint8Array;
  format: 'jpeg' | 'png' | 'webp' | 'gif';
  retryHint?: string;
}

function deps(responses: string[]) {
  const invokeModel = vi.fn(async (_input: InvokeInput) => {
    const next = responses.shift();
    if (next === undefined) throw new Error('추가 호출이 발생했다');
    return next;
  });
  return {
    readImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
    invokeModel,
  };
}

describe('recognizeLabelWithBedrock', () => {
  it('유효한 JSON 응답을 LabelExtraction 으로 반환한다', async () => {
    const d = deps([VALID_JSON]);
    const label = await recognizeLabelWithBedrock('labels/a.jpg', d);

    expect(label.recognized).toBe(true);
    expect(label.name?.value).toBe('19 Crimes');
    expect(d.invokeModel).toHaveBeenCalledOnce();
  });

  it('코드펜스로 감싼 응답도 파싱한다', async () => {
    const d = deps([`여기 결과입니다:\n\`\`\`json\n${VALID_JSON}\n\`\`\``]);
    const label = await recognizeLabelWithBedrock('labels/a.jpeg', d);
    expect(label.name?.value).toBe('19 Crimes');
  });

  it('스키마를 어기면 재생성하고, 성공하면 그 결과를 쓴다', async () => {
    const invalid = JSON.stringify({ recognized: true, name: { value: 'x', confidence: '아주높음' } });
    const d = deps([invalid, VALID_JSON]);

    const label = await recognizeLabelWithBedrock('labels/a.png', d);
    expect(label.recognized).toBe(true);
    expect(d.invokeModel).toHaveBeenCalledTimes(2);
  });

  it('재생성 힌트에 이전 위반 사유를 담아 보낸다', async () => {
    const invalid = JSON.stringify({ recognized: true, name: { value: 'x', confidence: 'nope' } });
    const d = deps([invalid, VALID_JSON]);

    await recognizeLabelWithBedrock('labels/a.png', d);
    expect(d.invokeModel.mock.calls[1]?.[0].retryHint).toBeTruthy();
  });

  it('3회 모두 실패하면 인식 실패로 돌려준다 (500 을 던지지 않는다)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps(['not json', '{ "recognized": "yes" }', '{}']);

    const label = await recognizeLabelWithBedrock('labels/a.jpg', d);
    expect(label.recognized).toBe(false);
    expect(label.failureReason).toBeTruthy();
    expect(d.invokeModel).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('지원하지 않는 확장자는 모델을 호출하지 않는다', async () => {
    const d = deps([VALID_JSON]);
    const label = await recognizeLabelWithBedrock('labels/a.heic', d);

    expect(label.recognized).toBe(false);
    expect(label.failureReason).toMatch(/지원하지 않는 이미지 형식/);
    expect(d.invokeModel).not.toHaveBeenCalled();
    expect(d.readImage).not.toHaveBeenCalled();
  });

  it('이미지 포맷을 확장자에서 유도해 모델에 전달한다', async () => {
    const d = deps([VALID_JSON]);
    await recognizeLabelWithBedrock('labels/a.webp', d);

    expect(d.invokeModel.mock.calls[0]?.[0].format).toBe('webp');
  });
});

describe('isDirectLabelFallbackEnabled', () => {
  it('명시적 옵트인일 때만 활성화된다', () => {
    const original = process.env.WAGANDA_LABEL_FALLBACK;

    process.env.WAGANDA_LABEL_FALLBACK = 'bedrock';
    expect(isDirectLabelFallbackEnabled()).toBe(true);

    process.env.WAGANDA_LABEL_FALLBACK = 'true';
    expect(isDirectLabelFallbackEnabled()).toBe(false);

    delete process.env.WAGANDA_LABEL_FALLBACK;
    expect(isDirectLabelFallbackEnabled()).toBe(false);

    if (original === undefined) delete process.env.WAGANDA_LABEL_FALLBACK;
    else process.env.WAGANDA_LABEL_FALLBACK = original;
  });
});
