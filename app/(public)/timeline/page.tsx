import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getTimelineView } from '@/lib/views/read';
import { TastingCard } from '@/components/tasting/TastingCard';
import { EmptyState } from '@/components/common/EmptyState';
import { RecordEntryPoint } from '@/components/record/RecordEntryPoint';

/**
 * app/(public)/timeline/page.tsx — 날짜별 타임라인 뷰 (14.6, R9).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '타임라인',
  description: '날짜순으로 모든 시음 기록을 되짚어봅니다',
};

export default async function TimelinePage(): Promise<ReactElement> {
  const repo = new DynamoDbRepository();
  const tastings = await getTimelineView(repo);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-cream-100">타임라인</h1>
        {/* 로그인 시 기록 추가 버튼, 비로그인 시 로그인 안내 */}
        <RecordEntryPoint />
      </div>
      {tastings.length === 0 ? (
        <EmptyState title="아직 시음 기록이 없습니다" />
      ) : (
        <ol className="flex flex-col gap-3">
          {tastings.map((tasting) => (
            <li key={tasting.tastingId}>
              <TastingCard tasting={tasting} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
