// @vitest-environment node
/**
 * SVG 자산 유효성 테스트.
 *
 * 파비콘은 브라우저가 XML 파서로 읽는다. 주석에 이중 하이픈을 넣었다가
 * `Comment must not contain '--' (double-hyphen)` 으로 렌더가 중단된 적이 있다
 * (CSS 변수명을 주석에 그대로 적은 탓이다). 빌드·타입체크로는 잡히지 않으므로
 * 여기서 파싱을 검증한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 저장소 루트 기준 SVG 자산 목록 */
const SVG_ASSETS = ['app/icon.svg'];

describe('SVG 자산', () => {
  for (const relativePath of SVG_ASSETS) {
    describe(relativePath, () => {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

      it('주석에 이중 하이픈이 없다 (XML 파싱 실패 원인)', () => {
        // 주석 구간만 뽑아 검사한다 — 경로 데이터의 음수 좌표(`a-1.1`)는 문제가 아니다.
        const comments = source.match(/<!--[\s\S]*?-->/g) ?? [];
        for (const comment of comments) {
          const inner = comment.slice('<!--'.length, -'-->'.length);
          expect(inner, `주석에 '--' 가 있으면 브라우저가 렌더를 중단한다: ${comment}`).not.toMatch(
            /--/,
          );
        }
      });

      it('XML 로 파싱된다', () => {
        // DOMParser 대신 정규식으로 최소 구조를 확인한다(Node 환경에 DOMParser 가 없다).
        // 실제 파싱 검증은 아래 태그 균형 검사로 대신한다.
        expect(source).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
        expect(source.trimEnd().endsWith('</svg>')).toBe(true);

        // 열린 태그와 닫힌 태그 수가 맞아야 한다(자기 닫는 태그 제외).
        const selfClosing = (source.match(/<[a-zA-Z][^>]*\/>/g) ?? []).length;
        const opening = (source.match(/<[a-zA-Z][^>]*>/g) ?? []).length - selfClosing;
        const closing = (source.match(/<\/[a-zA-Z][^>]*>/g) ?? []).length;
        expect(opening).toBe(closing);
      });

      it('viewBox 가 있어 어떤 크기로도 선명하게 렌더된다', () => {
        expect(source).toMatch(/viewBox="[\d.\s-]+"/);
      });
    });
  }
});
