import type { ReactElement } from 'react';
import type { Wine, Winery } from '@waganda/schemas';
import { winePlaceParts } from '@/lib/domain/region';
import { BOTTLE_SHAPE_LABEL, CLOSURE_LABEL, WINE_TYPE_LABEL } from '@/lib/views/labels';

/**
 * components/wine/WineInfoCard.tsx — 라벨 인식·웹 검색으로 모은 와인 정보 (정보성 표시).
 *
 * 시음 상세에서 "이 와인의 과거 기록" 위에 둔다.
 * 라벨에서 읽은 값과 검색·모델 지식으로 보강한 값을 한자리에 모아 보여준다.
 *
 * - 값이 없는 항목은 줄 자체를 그리지 않는다 (빈 칸을 늘어놓지 않는다)
 * - 확인 전 초안이면 배지로 알린다 — 자동으로 채운 값이라는 뜻이다
 * - 저신뢰 필드(`fieldConfidence`)는 색이 아닌 표시로도 구분한다 (접근성)
 */
interface WineInfoCardProps {
  wine: Wine;
  winery?: Winery;
  regionPath: string[];
}

/** 도메인만 뽑아 링크 텍스트로 쓴다 (URL 전체는 길어서 읽기 어렵다) */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function WineInfoCard({ wine, winery, regionPath }: WineInfoCardProps): ReactElement | null {
  const lowConfidenceFields = Object.entries(wine.fieldConfidence ?? {})
    .filter(([, confidence]) => confidence === 'low')
    .map(([field]) => field);

  const rows: { label: string; value: string; field?: string }[] = [];

  if (wine.wineType) {
    rows.push({
      label: '종류',
      value: WINE_TYPE_LABEL[wine.wineType] ?? wine.wineType,
      field: 'wineType',
    });
  }
  if (wine.grapes.length > 0) {
    rows.push({ label: '품종', value: wine.grapes.join(', '), field: 'grapes' });
  }
  // 카탈로그 지역 참조가 없으면 인식·검색으로 얻은 지역명을 쓴다
  const place = winePlaceParts(wine, regionPath);
  if (place.length > 0) {
    rows.push({ label: '산지', value: place.join(' > '), field: 'country' });
  }
  const wineryLabel = winery?.name ?? wine.wineryName;
  if (wineryLabel) {
    rows.push({ label: '와이너리', value: wineryLabel });
  }
  if (wine.alcoholPercent !== undefined) {
    rows.push({ label: '도수', value: `${wine.alcoholPercent}%`, field: 'alcoholPercent' });
  }
  if (wine.bottleShape || wine.closure) {
    rows.push({
      label: '병·마감',
      value: [
        wine.bottleShape ? (BOTTLE_SHAPE_LABEL[wine.bottleShape] ?? wine.bottleShape) : undefined,
        wine.closure ? (CLOSURE_LABEL[wine.closure] ?? wine.closure) : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  const hasContent =
    rows.length > 0 ||
    wine.characterNote !== undefined ||
    wine.tags.length > 0 ||
    wine.sourceUrls.length > 0;

  if (!hasContent) return null;

  return (
    <section aria-labelledby="wine-info-heading" className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="wine-info-heading" className="font-display text-lg text-cream-100">
          와인 정보
        </h2>
        {wine.draft && (
          <span className="rounded border border-gold-500/40 px-1.5 py-0.5 text-xs text-gold-300">
            확인 필요
          </span>
        )}
        <span className="text-muted text-xs">라벨 사진과 웹 검색으로 모은 정보입니다</span>
      </div>

      {wine.characterNote && (
        <p className="text-cream-200 mb-3 text-sm leading-relaxed">{wine.characterNote}</p>
      )}

      {rows.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-2 text-sm">
              <dt className="text-muted w-16 shrink-0">{row.label}</dt>
              <dd className="text-cream-100">
                {row.value}
                {row.field && lowConfidenceFields.includes(row.field) && (
                  // 색상만으로 구분하지 않는다
                  <span className="text-muted ml-1 text-xs">(추정)</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {wine.tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="와인 태그">
          {wine.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-gold-500/20 px-2 py-0.5 text-xs text-cream-200"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      {wine.sourceUrls.length > 0 && (
        <p className="text-muted mt-3 text-xs">
          출처{' '}
          {wine.sourceUrls.map((url, index) => (
            <span key={url}>
              {index > 0 && ' · '}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gold-300"
              >
                {hostOf(url)}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
