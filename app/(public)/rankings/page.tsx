import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getRankingsView } from '@/lib/views/read';
import { Rating } from '@/components/common/Rating';
import { EmptyState } from '@/components/common/EmptyState';

/**
 * app/(public)/rankings/page.tsx — 평점순 랭킹 뷰 (14.6).
 *
 * AI 랭킹과 수동 랭킹을 따로 두지 않는다. 최종 평점 하나로 줄을 세운다
 * (AI 평점이 기본, 수동 평점이 있으면 그것이 우선).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '평점 랭킹',
  description: '최종 평점 기준으로 정렬한 시음 기록 랭킹',
};

export default async function RankingsPage(): Promise<ReactElement> {
  const repo = new DynamoDbRepository();
  const rankings = await getRankingsView(repo);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl text-cream-100">평점 랭킹</h1>

      {rankings.length === 0 ? (
        <EmptyState title="랭킹에 표시할 평점이 없습니다" />
      ) : (
        <ol className="flex flex-col gap-2">
          {rankings.map((item, index) => (
            <li key={item.tastingId}>
              <Link
                href={`/tastings/${item.tastingId}`}
                className="card flex items-center justify-between gap-3 p-3 hover:border-gold-500/40"
              >
                <span className="flex items-center gap-3">
                  <span className="text-muted w-6 text-right text-sm">{index + 1}</span>
                  <span className="text-cream-100">
                    {item.wineName}
                    {item.vintage && (
                      <span className="text-muted ml-1 text-sm">{item.vintage}</span>
                    )}
                  </span>
                </span>
                <Rating
                  value={item.rating}
                  label={item.ratingSource === 'manual' ? '수동 평점' : 'AI 평점'}
                />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
