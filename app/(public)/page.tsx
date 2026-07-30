import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getDashboardView } from '@/lib/views/read';
import { TastingCard } from '@/components/tasting/TastingCard';
import { RecordEntryPoint } from '@/components/record/RecordEntryPoint';
import { TasteProfileCard } from '@/components/profile/TasteProfileCard';
import { DiscoveryCard } from '@/components/discovery/DiscoveryCard';
import { EmptyState } from '@/components/common/EmptyState';
import Link from 'next/link';

/**
 * app/(public)/page.tsx — 공개 대시보드 (14.1, R9).
 *
 * 최신 시음, 취향 카드, 최근 반응 일치도, 새 발견 카드, 진행 중인 분석을 표시한다.
 *
 * 빌드 시점에 DynamoDB 등 런타임 설정을 읽으면 `next build` 가 실패한다
 * (WAGANDA_TABLE_NAME 등 환경변수가 빌드 환경에 없기 때문). 이를 방지하기 위해
 * 이 라우트를 동적 렌더링으로 강제해 실제 요청 시점에만 데이터를 조회하게 한다.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '대시보드',
  description:
    '최근 시음, 취향 프로파일, 반응 일치도, 뜻밖의 발견을 한눈에 모아보는 와간다 대시보드',
};

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: '대기 중',
  transcribing: '음성 변환 중',
  analyzing: '분석 중',
};

export default async function DashboardPage(): Promise<ReactElement> {
  const repo = new DynamoDbRepository();
  const view = await getDashboardView(repo);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="recent-tastings-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-tastings-heading" className="font-display text-xl text-cream-100">
            최근 시음
          </h2>
          {/* 로그인 시 기록 추가 버튼, 비로그인 시 로그인 안내 */}
          <RecordEntryPoint />
        </div>
        {view.recentTastings.length === 0 ? (
          <EmptyState
            title="아직 시음 기록이 없어요"
            description="첫 시음을 기록하면 여기 표시됩니다."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {view.recentTastings.map((tasting) => (
              <li key={tasting.tastingId}>
                <TastingCard tasting={tasting} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="taste-profile-heading">
        <h2 id="taste-profile-heading" className="sr-only">
          취향 프로파일
        </h2>
        <TasteProfileCard profile={view.tasteProfile} />
      </section>

      <section aria-labelledby="agreement-heading">
        <h2 id="agreement-heading" className="font-display mb-3 text-xl text-cream-100">
          최근 반응 일치도
        </h2>
        {view.recentAgreementScores.length === 0 ? (
          <EmptyState
            title="아직 반응 일치도 데이터가 없어요"
            description="두 화자가 구분된 시음이 쌓이면 표시됩니다."
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {view.recentAgreementScores.map((entry) => (
              <li key={entry.tastingId}>
                <Link
                  href={`/tastings/${entry.tastingId}`}
                  className="card block px-3 py-2 text-sm hover:border-gold-500/40"
                >
                  <span className="text-gold-400 font-semibold">{entry.score.toFixed(0)}점</span>
                  <span className="text-muted ml-2">
                    {new Date(entry.tastedAt).toLocaleDateString('ko-KR')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="discoveries-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="discoveries-heading" className="font-display text-xl text-cream-100">
            새로운 발견
          </h2>
          <Link href="/discoveries" className="text-gold-400 text-sm hover:underline">
            전체 보기
          </Link>
        </div>
        {view.latestDiscoveries.length === 0 ? (
          <EmptyState
            title="아직 발견된 패턴이 없어요"
            description="기록이 쌓이면 뜻밖의 패턴이 나타납니다."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {view.latestDiscoveries.map((discovery) => (
              <li key={discovery.id}>
                <DiscoveryCard discovery={discovery} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.inProgressJobs.length > 0 && (
        <section aria-labelledby="in-progress-heading">
          <h2 id="in-progress-heading" className="font-display mb-3 text-xl text-cream-100">
            진행 중인 분석
          </h2>
          <ul role="status" className="flex flex-col gap-2">
            {view.inProgressJobs.map((job) => (
              <li key={job.tastingId} className="card p-3 text-sm">
                <span className="text-cream-100">{job.wineName}</span>
                <span className="text-gold-400 ml-2">
                  {JOB_STATUS_LABEL[job.status] ?? job.status}
                </span>
                {job.estimatedSec !== undefined && (
                  <span className="text-muted ml-2">
                    약 {Math.ceil(job.estimatedSec / 60)}분 예상
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
