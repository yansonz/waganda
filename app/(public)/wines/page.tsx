import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getWineListView } from '@/lib/views/read';
import { WineList } from '@/components/wine/WineList';

/**
 * app/(public)/wines/page.tsx — 와인 목록·검색 (14.4).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '와인 목록',
  description: '와간다에 기록된 모든 와인을 이름·와이너리·지역·품종으로 검색합니다',
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function WinesPage({ searchParams }: PageProps): Promise<ReactElement> {
  const { q } = await searchParams;
  const repo = new DynamoDbRepository();
  const wines = await getWineListView(repo, q);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl text-cream-100">와인</h1>
      <form action="/wines" method="get" role="search" className="flex gap-2">
        <label htmlFor="wine-search" className="sr-only">
          와인 검색
        </label>
        <input
          id="wine-search"
          name="q"
          type="search"
          defaultValue={q ?? ''}
          placeholder="이름·와이너리·지역·품종으로 검색"
          className="min-w-0 flex-1 rounded-md border border-gold-500/30 bg-ink-950 px-3 py-2 text-cream-100"
        />
        <button
          type="submit"
          className="shrink-0 whitespace-nowrap rounded-md border border-gold-500/40 px-4 py-2 text-sm text-cream-100 hover:bg-ink-800"
        >
          검색
        </button>
      </form>
      <WineList wines={wines} />
    </div>
  );
}
