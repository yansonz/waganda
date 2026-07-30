import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getWineryDetailView } from '@/lib/views/read';
import { EmptyState } from '@/components/common/EmptyState';

/**
 * app/(public)/wineries/[id]/page.tsx — 와이너리별 뷰 (14.6).
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const repo = new DynamoDbRepository();
  const view = await getWineryDetailView(repo, id);

  if (!view) return { title: '와이너리를 찾을 수 없습니다' };

  return {
    title: view.winery.name,
    description: `${view.winery.name}${view.regionPath.length > 0 ? ` (${view.regionPath.join(' > ')})` : ''} 의 와인 목록`,
  };
}

export default async function WineryDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const repo = new DynamoDbRepository();
  const view = await getWineryDetailView(repo, id);

  if (!view) {
    notFound();
  }

  const { winery, regionPath, wines } = view;

  return (
    <article className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-2xl text-cream-100">{winery.name}</h1>
        {regionPath.length > 0 && <p className="text-muted text-sm">{regionPath.join(' > ')}</p>}
        {winery.website && (
          <a
            href={winery.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-400 text-sm hover:underline"
          >
            웹사이트 방문
          </a>
        )}
      </header>

      <section aria-labelledby="winery-wines-heading">
        <h2 id="winery-wines-heading" className="font-display mb-2 text-lg text-cream-100">
          이 와이너리의 와인
        </h2>
        {wines.length === 0 ? (
          <EmptyState title="등록된 와인이 없습니다" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {wines.map((wine) => (
              <li key={wine.wineId}>
                <Link
                  href={`/wines/${wine.wineId}`}
                  className="card block p-3 hover:border-gold-500/40"
                >
                  <p className="text-cream-100">
                    {wine.name}
                    {wine.vintage && (
                      <span className="text-muted ml-1 text-sm">{wine.vintage}</span>
                    )}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
