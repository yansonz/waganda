/**
 * 빈 필드 채우기 테스트 (fillMissingWineFields).
 *
 * 같은 와인을 다시 마셨을 때 새로 인식·보강한 정보를 버리지 않되,
 * **기존 값과 편집자 수정본은 덮어쓰지 않는다.**
 */
import { describe, expect, it } from 'vitest';
import { createWine, fillMissingWineFields } from '@/lib/services/wines';
import { InMemoryRepository } from '../views/testRepository';

describe('fillMissingWineFields', () => {
  it('비어 있던 필드를 채우고 채운 목록을 알려준다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '19 Crimes', draft: true });

    const result = await fillMissingWineFields(repo, wine.id, {
      country: '호주',
      grapes: ['Shiraz'],
      alcoholPercent: 13.5,
      wineType: 'red',
    });

    expect(result.filled.sort()).toEqual(['alcoholPercent', 'country', 'grapes', 'wineType']);
    expect(result.wine.country).toBe('호주');
    expect(result.wine.grapes).toEqual(['Shiraz']);
    expect(result.wine.alcoholPercent).toBe(13.5);
  });

  it('이미 값이 있는 필드는 덮어쓰지 않는다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, {
      name: '19 Crimes',
      country: '프랑스',
      alcoholPercent: 12,
    });

    const result = await fillMissingWineFields(repo, wine.id, {
      country: '호주',
      alcoholPercent: 13.5,
      grapes: ['Shiraz'],
    });

    expect(result.wine.country).toBe('프랑스');
    expect(result.wine.alcoholPercent).toBe(12);
    expect(result.filled).toEqual(['grapes']);
  });

  it('비어 있는 배열만 채운다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '19 Crimes', grapes: ['Merlot'] });

    const result = await fillMissingWineFields(repo, wine.id, {
      grapes: ['Shiraz'],
      labelTags: ['minimal'],
    });

    expect(result.wine.grapes).toEqual(['Merlot']);
    expect(result.wine.labelTags).toEqual(['minimal']);
    expect(result.filled).toEqual(['labelTags']);
  });

  it('초안 상태는 유지한다 (사람이 확인한 것이 아니다)', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '19 Crimes', draft: true });

    const result = await fillMissingWineFields(repo, wine.id, { country: '호주' });
    expect(result.wine.draft).toBe(true);
  });

  it('채울 것이 없으면 저장하지 않는다 (rev 가 그대로다)', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '19 Crimes', country: '호주' });

    const result = await fillMissingWineFields(repo, wine.id, { country: '프랑스' });
    expect(result.filled).toEqual([]);
    expect(result.wine.rev).toBe(wine.rev);
  });

  it('없는 와인은 오류로 알린다', async () => {
    const repo = new InMemoryRepository();
    await expect(fillMissingWineFields(repo, 'missing', { country: '호주' })).rejects.toThrow();
  });
});
