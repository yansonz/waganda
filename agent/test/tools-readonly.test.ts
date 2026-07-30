import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { READONLY_TOOL_NAMES } from '../src/tools/index.js';
import { ComputeStatsSpec } from '@waganda/schemas';

const TOOLS_INDEX_PATH = fileURLToPath(new URL('../src/tools/index.ts', import.meta.url));
const REPOSITORY_PATH = fileURLToPath(new URL('../../lib/db/repository.ts', import.meta.url));

/** Repository 인터페이스에서 쓰기 계열 메서드 이름(put/patch/delete)을 정적으로 추출한다 */
function extractWriteMethodNames(): string[] {
  const source = readFileSync(REPOSITORY_PATH, 'utf-8');
  const sourceFile = ts.createSourceFile(REPOSITORY_PATH, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Repository') {
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
          const name = member.name.text;
          if (/^(put|patch|delete)/.test(name)) {
            names.push(name);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

describe('LLM 노출 도구 정적 검증 — 전부 읽기 전용이어야 한다 (R10)', () => {
  it('READONLY_TOOL_NAMES 화이트리스트가 예상한 9개 도구와 정확히 일치한다', () => {
    expect([...READONLY_TOOL_NAMES].sort()).toEqual(
      [
        'getWine',
        'findWines',
        'getTastingsForWine',
        'getRecentTastings',
        'findSimilarTastings',
        'getTasteProfile',
        'listDiscoveries',
        'computeStats',
        'webSearch',
      ].sort(),
    );
  });

  it('tools/index.ts 소스에 Repository 의 쓰기 메서드(put/patch/delete) 이름이 등장하지 않는다', () => {
    const source = readFileSync(TOOLS_INDEX_PATH, 'utf-8');
    const writeMethods = extractWriteMethodNames();
    expect(writeMethods.length).toBeGreaterThan(0); // 추출 자체가 실패하지 않았는지 확인

    for (const method of writeMethods) {
      // 단어 경계로 정확히 매칭 — 부분 문자열 오탐 방지
      const pattern = new RegExp(`\\b${method}\\b`);
      expect(source, `tools/index.ts 가 쓰기 메서드 '${method}' 를 참조해서는 안 된다`).not.toMatch(
        pattern,
      );
    }
  });

  it('tools/catalog.ts, tools/tastings.ts, tools/stats.ts, tools/web.ts 도 쓰기 메서드를 참조하지 않는다', () => {
    const writeMethods = extractWriteMethodNames();
    const files = ['../src/tools/catalog.ts', '../src/tools/tastings.ts', '../src/tools/stats.ts', '../src/tools/web.ts'];

    for (const relativePath of files) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8');
      for (const method of writeMethods) {
        const pattern = new RegExp(`\\b${method}\\b`);
        expect(source, `${relativePath} 가 쓰기 메서드 '${method}' 를 참조해서는 안 된다`).not.toMatch(
          pattern,
        );
      }
    }
  });
});

describe('computeStats 도구 — 스펙 외 입력 거부', () => {
  it('정의되지 않은 groupBy 값은 거부된다', () => {
    const result = ComputeStatsSpec.safeParse({ groupBy: 'sql_injection_attempt', metric: 'meanRating' });
    expect(result.success).toBe(false);
  });

  it('metric 이 meanNoteAxis 인데 noteAxis 가 없으면 거부된다', () => {
    const result = ComputeStatsSpec.safeParse({ groupBy: 'grape', metric: 'meanNoteAxis' });
    expect(result.success).toBe(false);
  });

  it('minSampleSize 가 100 을 초과하면 거부된다', () => {
    const result = ComputeStatsSpec.safeParse({ groupBy: 'grape', metric: 'meanRating', minSampleSize: 1000 });
    expect(result.success).toBe(false);
  });

  it('임의의 추가 필드(예: 코드 실행 시도)가 있어도 스키마가 정의한 필드만 통과한다', () => {
    const result = ComputeStatsSpec.safeParse({
      groupBy: 'grape',
      metric: 'meanRating',
      rawSql: 'DROP TABLE wines',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['rawSql']).toBeUndefined();
    }
  });

  it('유효한 스펙은 통과한다', () => {
    const result = ComputeStatsSpec.safeParse({ groupBy: 'grape', metric: 'meanRating', minSampleSize: 4 });
    expect(result.success).toBe(true);
  });
});
