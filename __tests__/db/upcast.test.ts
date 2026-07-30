import { describe, expect, it, vi } from 'vitest';
import { Wine } from '@waganda/schemas';
import { upcastMany, upcastRecord } from '@/lib/db/upcast';

describe('upcastRecord — v1 → v2 승격', () => {
  it('rev 필드가 없으면 0 으로 채운다', () => {
    const v1 = { schemaVersion: 1, id: 'w1', name: 'Test' };
    const result = upcastRecord(v1) as Record<string, unknown>;
    expect(result['rev']).toBe(0);
    expect(result['schemaVersion']).toBe(2);
  });

  it('grapes 가 문자열 단일값이면 배열로 감싼다', () => {
    const v1 = { schemaVersion: 1, id: 'w1', name: 'Test', grapes: 'Nebbiolo' };
    const result = upcastRecord(v1) as Record<string, unknown>;
    expect(result['grapes']).toEqual(['Nebbiolo']);
  });

  it('grapes 가 빈 문자열이면 빈 배열이 된다', () => {
    const v1 = { schemaVersion: 1, id: 'w1', name: 'Test', grapes: '' };
    const result = upcastRecord(v1) as Record<string, unknown>;
    expect(result['grapes']).toEqual([]);
  });

  it('grapes 가 이미 배열이면 그대로 둔다', () => {
    const v1 = { schemaVersion: 1, id: 'w1', name: 'Test', grapes: ['Nebbiolo', 'Barbera'] };
    const result = upcastRecord(v1) as Record<string, unknown>;
    expect(result['grapes']).toEqual(['Nebbiolo', 'Barbera']);
  });

  it('priceBand 가 없고 priceKrw 가 있으면 파생시킨다', () => {
    const v1 = { schemaVersion: 1, id: 't1', priceKrw: 35_000 };
    const result = upcastRecord(v1) as Record<string, unknown>;
    expect(result['priceBand']).toBe('20k_50k');
  });

  it('priceKrw 가 없으면 priceBand 를 채우지 않는다', () => {
    const v1 = { schemaVersion: 1, id: 't1' };
    const result = upcastRecord(v1) as Record<string, unknown>;
    expect(result['priceBand']).toBeUndefined();
  });

  it('이미 priceBand 가 있으면 덮어쓰지 않는다', () => {
    const v1 = { schemaVersion: 1, id: 't1', priceKrw: 35_000, priceBand: 'over_200k' };
    const result = upcastRecord(v1) as Record<string, unknown>;
    expect(result['priceBand']).toBe('over_200k');
  });

  it('이미 최신 버전이면 변경 없이 그대로 반환한다', () => {
    const v2 = { schemaVersion: 2, id: 'w1', rev: 3 };
    const result = upcastRecord(v2) as Record<string, unknown>;
    expect(result).toEqual(v2);
  });

  it('object 가 아닌 입력은 그대로 반환한다', () => {
    expect(upcastRecord(null)).toBeNull();
    expect(upcastRecord('foo')).toBe('foo');
    expect(upcastRecord([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('upcastMany — 구버전 레코드 읽기 + 격리', () => {
  const baseWine = {
    id: 'w1',
    type: 'WINE' as const,
    name: 'Barolo 2018',
    nameNormalized: 'barolo 2018',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('v1 와인 레코드(rev 없음, grapes 단일 문자열)를 승격 후 정상 파싱한다', () => {
    const v1Record = {
      ...baseWine,
      schemaVersion: 1,
      grapes: 'Nebbiolo',
    };

    const { ok, quarantined } = upcastMany([v1Record], Wine);

    expect(quarantined).toHaveLength(0);
    expect(ok).toHaveLength(1);
    expect(ok[0].schemaVersion).toBe(2);
    expect(ok[0].rev).toBe(0);
    expect(ok[0].grapes).toEqual(['Nebbiolo']);
  });

  it('Zod 파싱 실패 레코드는 console.warn 로그 후 격리하고 나머지는 그대로 반환한다', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const validRecord = { ...baseWine, schemaVersion: 2, rev: 0, grapes: [] };
    const invalidRecord = { ...baseWine, id: undefined, schemaVersion: 2, rev: 0 }; // id 없음 → 파싱 실패

    const { ok, quarantined } = upcastMany([validRecord, invalidRecord], Wine);

    expect(ok).toHaveLength(1);
    expect(ok[0].id).toBe('w1');
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].raw).toBe(invalidRecord);
    expect(quarantined[0].reason).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('전체가 파싱 실패해도 예외를 던지지 않고 quarantined 로만 보고한다', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const invalid1 = { foo: 'bar' };
    const invalid2 = { schemaVersion: 2 };

    const { ok, quarantined } = upcastMany([invalid1, invalid2], Wine);

    expect(ok).toHaveLength(0);
    expect(quarantined).toHaveLength(2);

    warnSpy.mockRestore();
  });

  it('빈 배열 입력은 빈 결과를 반환한다', () => {
    const { ok, quarantined } = upcastMany([], Wine);
    expect(ok).toEqual([]);
    expect(quarantined).toEqual([]);
  });
});
