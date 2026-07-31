import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { DynamoDbRepository } from '@/lib/db/repository';
import { getTastingDetailView, mediaUrl } from '@/lib/views/read';
import { Rating } from '@/components/common/Rating';
import { ManualRatingControl } from '@/components/tasting/ManualRatingControl';
import { NotesRadar } from '@/components/tasting/NotesRadar';
import { EmotionTimeline } from '@/components/tasting/EmotionTimeline';
import { HighlightList } from '@/components/tasting/HighlightList';
import { TastingCard } from '@/components/tasting/TastingCard';
import { TastingEditControls } from '@/components/tasting/TastingEditControls';
import { FitBadge } from '@/components/wine/FitBadge';
import { WineInfoCard } from '@/components/wine/WineInfoCard';
import { EmptyState } from '@/components/common/EmptyState';
import { SERVICE_TIME_ZONE } from '@/lib/domain/types';

/**
 * app/(public)/tastings/[id]/page.tsx — 시음 상세 화면 (14.2, R9).
 *
 * 라벨 사진, 와인 메타데이터, 오디오 플레이어, 트랜스크립트, 하이라이트,
 * 5축 레이더, 감정 타임라인, 해당 와인의 과거 기록을 표시한다.
 *
 * DB 조회가 요청 시점에만 일어나도록 동적 렌더링을 강제한다(build 시점 환경변수 미설정 방지).
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const repo = new DynamoDbRepository();
  const view = await getTastingDetailView(repo, id);

  if (!view) {
    return { title: '시음 기록을 찾을 수 없습니다' };
  }

  const title = view.wine
    ? `${view.wine.name}${view.wine.vintage ? ` ${view.wine.vintage}` : ''} 시음 기록`
    : '시음 기록';
  const description =
    view.analysis?.editedSummary ?? view.analysis?.summary ?? '와간다 시음 기록 상세';
  const image = view.tasting.labelImageKey ? mediaUrl(view.tasting.labelImageKey) : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function TastingDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const repo = new DynamoDbRepository();
  const view = await getTastingDetailView(repo, id);

  if (!view) {
    notFound();
  }

  const {
    tasting,
    wine,
    winery,
    regionPath,
    recordings,
    analysis,
    job,
    pastTastingsForWine,
    fit,
    displayRating,
    ratingSource,
  } = view;
  const primaryRecording = recordings[0];
  const mapping = primaryRecording?.speakers?.mapping ?? null;
  const mappingConfidence = primaryRecording?.speakers?.mappingConfidence ?? 'none';

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-cream-100">
            {wine?.name ?? '알 수 없는 와인'}
            {wine?.vintage && <span className="text-muted ml-2 text-lg">{wine.vintage}</span>}
          </h1>
          <p className="text-muted text-sm">
            <time dateTime={tasting.tastedAt}>
              {new Date(tasting.tastedAt).toLocaleString('ko-KR', { timeZone: SERVICE_TIME_ZONE })}
            </time>
            {winery && <span className="ml-2">· {winery.name}</span>}
            {regionPath.length > 0 && <span className="ml-2">· {regionPath.join(' > ')}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {/*
              평점은 **하나만** 보여준다 — 수동 평점이 있으면 수동, 없으면 AI 평점.
              두 값 모두 DB 에 보존되지만 화면에서 섞어 보여주지 않는다.
            */}
            {displayRating !== undefined && (
              <Rating
                value={displayRating}
                label={ratingSource === 'manual' ? '수동 평점' : 'AI 평점'}
              />
            )}
            {displayRating !== undefined && (
              // 출처는 Rating 의 접근성 이름에 이미 포함되어 있어 중복 낭독을 막는다.
              <span aria-hidden="true" className="text-muted text-xs">
                {ratingSource === 'manual' ? '수동 평점' : 'AI 평점'}
              </span>
            )}
            <FitBadge level={fit} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <TastingEditControls
            tastingId={tasting.id}
            wineName={wine?.name ?? '이 와인'}
            rev={tasting.rev}
          />
          <ManualRatingControl
            tastingId={tasting.id}
            currentRating={displayRating}
            ratingSource={ratingSource}
            rev={tasting.rev}
          />
        </div>
      </header>

      {tasting.labelImageKey && (
        <Image
          src={mediaUrl(tasting.labelImageKey)}
          alt={`${wine?.name ?? '와인'} 라벨 사진`}
          width={320}
          height={320}
          /*
           * 최적화를 쓰지 않는다.
           * `next/image` 최적화는 서버가 원본을 다시 가져와 변환하는데, `/media/*` 는
           * CloudFront 가 S3 로 직접 보내는 경로라 Lambda 안에서는 접근할 수 없다
           * (`app/media/[...key]/route.ts` 는 로컬 전용이다). 그래서 최적화를 켜면
           * "The requested resource isn't a valid image" 로 깨진다.
           * 브라우저가 CDN 에서 바로 받게 하고, 캐시는 `/media/*` 정책(30일)이 담당한다.
           */
          unoptimized
          className="max-h-80 w-auto rounded-lg border border-gold-500/20 object-contain"
        />
      )}

      {job && job.status !== 'completed' && (
        <p role="status" className="card p-3 text-sm text-cream-200">
          분석 상태: {job.status}
          {job.estimatedSec !== undefined && ` (약 ${Math.ceil(job.estimatedSec / 60)}분 예상)`}
        </p>
      )}

      {/*
        녹음 원본과 전사는 화면에 노출하지 않는다.
        사적인 대화가 그대로 재생·표시되는 것을 원하지 않기 때문이며,
        분석 결과(요약·하이라이트·노트)만 보여준다.
        원본은 삭제하지 않고 S3·DB 에 보존한다 — 재분석과 근거 추적에 필요하다.
      */}

      {analysis ? (
        <>
          <section aria-labelledby="summary-heading">
            <h2 id="summary-heading" className="font-display mb-2 text-lg text-cream-100">
              시음 요약
            </h2>
            {/* 편집자가 수정했으면 수정본을 보여주되, 원본 AI 생성물은 DB 에 그대로 보존된다 (R6) */}
            <p className="text-cream-200 whitespace-pre-line text-sm leading-relaxed">
              {analysis.editedSummary ?? analysis.summary}
            </p>
            {analysis.editedSummary && (
              <p className="text-muted mt-2 text-xs">
                편집자가 수정한 요약입니다 (원본은 보존됩니다)
              </p>
            )}
          </section>

          <section aria-labelledby="highlights-heading">
            <h2 id="highlights-heading" className="font-display mb-2 text-lg text-cream-100">
              반응 하이라이트
            </h2>
            <HighlightList
              highlights={analysis.editedHighlights ?? analysis.highlights}
              mapping={mapping}
              mappingConfidence={mappingConfidence}
            />
          </section>

          <section
            aria-labelledby="notes-heading"
            className="grid grid-cols-1 gap-6 sm:grid-cols-2"
          >
            <div>
              <h2 id="notes-heading" className="font-display mb-2 text-lg text-cream-100">
                5축 시음 노트
              </h2>
              {analysis.notes ? (
                <NotesRadar values={analysis.notes} />
              ) : (
                // 발화가 없어 5축을 판단하지 못한 기록 (R5: 무음도 실패가 아니다)
                <p className="text-muted text-sm">발화가 없어 5축 노트를 만들지 못했습니다.</p>
              )}
            </div>
            <div>
              <h2 className="font-display mb-2 text-lg text-cream-100">감정 타임라인</h2>
              <EmotionTimeline points={analysis.emotionTimeline ?? []} />
            </div>
          </section>

          {analysis.speakerContrast && (
            <section aria-labelledby="contrast-heading">
              <h2 id="contrast-heading" className="font-display mb-2 text-lg text-cream-100">
                두 화자 반응 비교
              </h2>
              <p className="text-cream-200 text-sm">{analysis.speakerContrast}</p>
            </section>
          )}

          {analysis.comparisonToPast && (
            <section aria-labelledby="comparison-heading">
              <h2 id="comparison-heading" className="font-display mb-2 text-lg text-cream-100">
                과거 대비 변화
              </h2>
              <p className="text-cream-200 text-sm">{analysis.comparisonToPast}</p>
            </section>
          )}
        </>
      ) : (
        <EmptyState
          title="분석 결과가 아직 없습니다"
          description="분석이 완료되면 이 화면이 자동으로 채워집니다."
        />
      )}

      {/* 라벨·웹 검색으로 모은 와인 정보 — 과거 기록 바로 위에 둔다 */}
      {wine && <WineInfoCard wine={wine} winery={winery} regionPath={regionPath} />}

      <section aria-labelledby="past-tastings-heading">
        <h2 id="past-tastings-heading" className="font-display mb-2 text-lg text-cream-100">
          이 와인의 과거 기록
        </h2>
        {pastTastingsForWine.length === 0 ? (
          <EmptyState title="이 와인의 다른 시음 기록이 없습니다" />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pastTastingsForWine.map((past) => (
              <li key={past.tastingId}>
                <TastingCard tasting={past} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {wine && (
        <Link href={`/wines/${wine.id}`} className="text-gold-400 text-sm hover:underline">
          이 와인의 전체 기록 보기 →
        </Link>
      )}
    </article>
  );
}
