import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getExploreView } from '@/lib/views/read';
import { EmptyState } from '@/components/common/EmptyState';

/**
 * app/(public)/explore/[[...path]]/page.tsx — 지역 계층 탐색 (14.5).
 *
 * 국가 > 지역 > 세부 산지 순으로 탐색하며 브레드크럼을 제공한다.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ path?: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { path } = await params;
  const repo = new DynamoDbRepository();
  const view = await getExploreView(repo, path ?? []);

  if (view.notFound) {
    return { title: '지역을 찾을 수 없습니다' };
  }

  const title =
    view.breadcrumb.length > 0 ? view.breadcrumb.map((b) => b.name).join(' > ') : '지역 탐색';
  return { title, description: `${title} 지역의 와인을 탐색합니다` };
}

export default async function ExplorePage({ params }: PageProps): Promise<ReactElement> {
  const { path } = await params;
  const currentPath = path ?? [];
  const repo = new DynamoDbRepository();
  const view = await getExploreView(repo, currentPath);

  if (view.notFound) {
    return (
      <EmptyState title="지역을 찾을 수 없습니다" description="존재하지 않는 탐색 경로입니다." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl text-cream-100">지역 탐색</h1>

      <nav aria-label="브레드크럼" className="text-sm">
        <ol className="flex flex-wrap items-center gap-1 text-muted">
          <li>
            <Link href="/explore" className="hover:text-gold-400 hover:underline">
              전체
            </Link>
          </li>
          {view.breadcrumb.map((crumb, index) => {
            const href = `/explore/${view.breadcrumb
              .slice(0, index + 1)
              .map((b) => b.id)
              .join('/')}`;
            const isLast = index === view.breadcrumb.length - 1;
            return (
              <li key={crumb.id} className="flex items-center gap-1">
                <span aria-hidden="true">/</span>
                {isLast ? (
                  <span aria-current="page" className="text-cream-100">
                    {crumb.name}
                  </span>
                ) : (
                  <Link href={href} className="hover:text-gold-400 hover:underline">
                    {crumb.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {view.children.length > 0 && (
        <section aria-labelledby="subregions-heading">
          <h2 id="subregions-heading" className="font-display mb-2 text-lg text-cream-100">
            하위 지역
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {view.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/explore/${[...currentPath, child.id].join('/')}`}
                  className="card block p-3 hover:border-gold-500/40"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="wines-in-region-heading">
        <h2 id="wines-in-region-heading" className="font-display mb-2 text-lg text-cream-100">
          이 지역의 와인
        </h2>
        {view.winesInRegion.length === 0 ? (
          <EmptyState title="이 지역에 등록된 와인이 없습니다" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {view.winesInRegion.map((wine) => (
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
                  {wine.wineryName && <p className="text-muted text-sm">{wine.wineryName}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.children.length === 0 &&
        view.winesInRegion.length === 0 &&
        currentPath.length === 0 && (
          <EmptyState
            title="아직 등록된 지역이 없습니다"
            description="와인을 등록하면 지역이 자동으로 나타납니다."
          />
        )}
    </div>
  );
}
