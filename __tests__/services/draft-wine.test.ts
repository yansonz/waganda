/**
 * 초안 와인(draft) 동작 테스트.
 *
 * 기록 흐름은 라벨 사진 인식 결과로 와인을 **즉시** 만들어 시음을 붙인다
 * (현실 순서: 사진 → 녹음 → 확인). 그 와인은 확인 전까지 초안이며,
 * 카탈로그 목록에서는 숨긴다. 편집자가 수정하면 초안이 해제된다.
 */
import { describe, expect, it } from 'vitest';
import { createWine, updateWine } from '@/lib/services/wines';
import { createTasting } from '@/lib/services/tastings';
import { getWineListView } from '@/lib/views/read';
import { InMemoryRepository } from '../views/testRepository';

describe('초안 와인 생성', () => {
  it('draft: true 로 생성하면 초안으로 저장된다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '초안 와인', draft: true });
    expect(wine.draft).toBe(true);
  });

  it('draft 를 주지 않으면 확정 와인이다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '확정 와인' });
    expect(wine.draft).toBe(false);
  });

  it('라벨 인식 필드를 함께 저장한다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, {
      name: 'Château Margaux',
      vintage: 2015,
      country: '프랑스',
      grapes: ['Merlot'],
      labelTags: ['ornate'],
      bottleShape: 'bordeaux',
      draft: true,
    });

    expect(wine).toMatchObject({
      vintage: 2015,
      country: '프랑스',
      grapes: ['Merlot'],
      labelTags: ['ornate'],
      bottleShape: 'bordeaux',
      draft: true,
    });
  });
});

describe('초안 해제', () => {
  it('편집자가 수정하면 초안이 해제된다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '초안 와인', draft: true });

    const updated = await updateWine(repo, wine.id, wine.rev, { vintage: 2019 });
    expect(updated.draft).toBe(false);
    expect(updated.vintage).toBe(2019);
  });

  it('draft 를 명시하면 그 값을 존중한다', async () => {
    const repo = new InMemoryRepository();
    const wine = await createWine(repo, { name: '초안 와인', draft: true });

    const updated = await updateWine(repo, wine.id, wine.rev, { draft: true, vintage: 2019 });
    expect(updated.draft).toBe(true);
  });
});

describe('카탈로그 목록에서의 초안 취급', () => {
  it('시음이 없는 초안 와인은 목록에 나오지 않는다', async () => {
    const repo = new InMemoryRepository();
    await createWine(repo, { name: '확정 와인' });
    await createWine(repo, { name: '떠도는 초안', draft: true });

    const list = await getWineListView(repo);
    const names = list.map((item) => item.name);

    expect(names).toContain('확정 와인');
    expect(names).not.toContain('떠도는 초안');
  });

  it('시음이 붙은 초안 와인은 확인 대상이므로 목록에 나온다', async () => {
    const repo = new InMemoryRepository();
    const draft = await createWine(repo, { name: '기록된 초안', draft: true });
    await createTasting(repo, { wineId: draft.id, tastedAt: new Date().toISOString() });

    const list = await getWineListView(repo);
    expect(list.map((item) => item.name)).toContain('기록된 초안');
  });

  it('시음이 붙은 초안은 확인 필요 표시를 위해 draft 플래그를 함께 넘긴다', async () => {
    const repo = new InMemoryRepository();
    const draft = await createWine(repo, { name: '확인 대기 와인', draft: true });
    await createTasting(repo, { wineId: draft.id, tastedAt: new Date().toISOString() });

    const list = await getWineListView(repo);
    const item = list.find((w) => w.name === '확인 대기 와인');
    expect(item?.draft).toBe(true);
  });

  it('확정 와인은 draft 플래그가 false 다', async () => {
    const repo = new InMemoryRepository();
    await createWine(repo, { name: '확정 와인' });
    const list = await getWineListView(repo);
    expect(list.find((w) => w.name === '확정 와인')?.draft).toBe(false);
  });

  it('검색 결과에도 시음 없는 초안은 포함되지 않는다', async () => {
    const repo = new InMemoryRepository();
    await createWine(repo, { name: 'Margaux 확정' });
    await createWine(repo, { name: 'Margaux 초안', draft: true });

    const list = await getWineListView(repo, 'margaux');
    const names = list.map((item) => item.name);

    expect(names).toContain('Margaux 확정');
    expect(names).not.toContain('Margaux 초안');
  });
});
