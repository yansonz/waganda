import type { ReactElement } from 'react';
import type { ProfileAttribute } from '@waganda/schemas';
import { NotesRadar } from '@/components/tasting/NotesRadar';
import { SimpleMarkdown } from '@/components/common/SimpleMarkdown';
import type { TasteProfileView } from '@/lib/views/read';

/**
 * components/profile/TasteProfileCard.tsx — 취향 프로파일 카드 (12.4, R7).
 *
 * 완료 시음 5건 미달이면 비활성 상태 + 진행률을 표시하고, 활성 상태면
 * 5축 레이더 차트 + 키워드 태그 + 선호/비선호 속성을 표시한다.
 */
interface TasteProfileCardProps {
  profile: TasteProfileView;
}

function AttributeTag({
  attribute,
  tone,
}: {
  attribute: ProfileAttribute;
  tone: 'liked' | 'disliked';
}): ReactElement {
  const toneClass =
    tone === 'liked'
      ? 'bg-gold-500/15 text-gold-400 border-gold-500/40'
      : 'bg-ink-950 text-cream-300 border-cream-300/20';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${toneClass}`}
    >
      {attribute.key}
      {attribute.grade === 'reference' && (
        <span className="text-muted">(참고, n={attribute.n})</span>
      )}
    </span>
  );
}

export function TasteProfileCard({ profile }: TasteProfileCardProps): ReactElement {
  if (!profile.active) {
    const progressPercent = Math.round(profile.progress * 100);
    return (
      <div className="card p-4">
        <h2 className="font-display text-lg text-cream-100">취향 프로파일</h2>
        <p role="status" className="text-muted mt-1 text-sm">
          아직 취향 프로파일이 비활성 상태입니다. 완료된 시음 기록이 5건이 되면 활성화됩니다.
        </p>
        <div
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="취향 프로파일 활성화 진행률"
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-950"
        >
          <div className="h-full bg-gold-500" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="text-muted mt-1 text-xs">
          {profile.tastingCount} / 5건 ({progressPercent}%)
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg text-cream-100">취향 프로파일</h2>
      {profile.narrative && (
        <SimpleMarkdown
          text={profile.narrative}
          className="text-cream-200 mt-1 flex flex-col gap-1.5 text-sm"
        />
      )}

      <NotesRadar values={profile.axes ?? {}} size={200} />

      {profile.keywords.length > 0 && (
        <ul aria-label="취향 키워드" className="mt-2 flex flex-wrap gap-1.5">
          {profile.keywords.map((keyword) => (
            <li
              key={keyword}
              className="rounded-full border border-gold-500/30 px-2.5 py-0.5 text-xs text-cream-200"
            >
              {keyword}
            </li>
          ))}
        </ul>
      )}

      {profile.liked.length > 0 && (
        <div className="mt-3">
          <h3 className="text-muted text-xs font-semibold uppercase">선호</h3>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {profile.liked.map((attr) => (
              <li key={`${attr.dimension}-${attr.key}`}>
                <AttributeTag attribute={attr} tone="liked" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile.disliked.length > 0 && (
        <div className="mt-3">
          <h3 className="text-muted text-xs font-semibold uppercase">비선호</h3>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {profile.disliked.map((attr) => (
              <li key={`${attr.dimension}-${attr.key}`}>
                <AttributeTag attribute={attr} tone="disliked" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile.shoppingGuide && (
        <SimpleMarkdown
          text={profile.shoppingGuide}
          className="text-muted mt-3 flex flex-col gap-1.5 border-t border-gold-500/15 pt-3 text-sm"
        />
      )}
    </div>
  );
}
