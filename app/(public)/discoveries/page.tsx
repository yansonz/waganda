import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getDiscoveriesView } from '@/lib/views/read';
import { DiscoveryCard } from '@/components/discovery/DiscoveryCard';
import { EmptyState } from '@/components/common/EmptyState';

/**
 * app/(public)/discoveries/page.tsx — 발견 카드 전체 목록 (13.6, R8).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '뜻밖의 발견',
  description: '누적 시음 데이터에서 자동으로 발견된 뜻밖의 패턴 목록',
};

export default async function DiscoveriesPage(): Promise<ReactElement> {
  const repo = new DynamoDbRepository();
  const discoveries = await getDiscoveriesView(repo);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl text-cream-100">뜻밖의 발견</h1>
      {discoveries.length === 0 ? (
        <EmptyState
          title="아직 발견된 패턴이 없습니다"
          description="완료된 시음 기록이 10건 이상 쌓이면 패턴 발견이 시작됩니다."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {discoveries.map((discovery) => (
            <li key={discovery.id}>
              <DiscoveryCard discovery={discovery} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
