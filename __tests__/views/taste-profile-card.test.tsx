import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TasteProfileCard } from '@/components/profile/TasteProfileCard';
import type { TasteProfileView } from '@/lib/views/read';

/**
 * __tests__/views/taste-profile-card.test.tsx — 14.9 검증:
 * 프로파일 비활성화 시 진행률 표시, 활성화 시 5축 레이더/키워드 렌더링.
 */
describe('<TasteProfileCard>', () => {
  it('5건 미달이면 비활성화 상태와 진행률을 표시한다', () => {
    const profile: TasteProfileView = {
      active: false,
      tastingCount: 3,
      progress: 0.6,
      liked: [],
      disliked: [],
      keywords: [],
      recommendations: [],
      agreementTrend: [],
    };

    render(<TasteProfileCard profile={profile} />);

    expect(screen.getByRole('status')).toHaveTextContent('비활성 상태');
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByText('3 / 5건 (60%)')).toBeInTheDocument();
  });

  it('활성화 상태면 키워드와 서술을 표시한다', () => {
    const profile: TasteProfileView = {
      active: true,
      tastingCount: 8,
      progress: 1,
      axes: { acidity: 4, tannin: 3, body: 3.5, aroma: 4.5, finish: 3 },
      liked: [{ dimension: 'grape', key: 'Nebbiolo', n: 5, meanRating: 4.4, grade: 'solid' }],
      disliked: [],
      keywords: ['묵직한 바디', '오크향'],
      narrative: '묵직하고 향이 풍부한 와인을 선호합니다.',
      recommendations: [],
      agreementTrend: [],
    };

    render(<TasteProfileCard profile={profile} />);

    expect(screen.getByText('묵직하고 향이 풍부한 와인을 선호합니다.')).toBeInTheDocument();
    expect(screen.getByText('묵직한 바디')).toBeInTheDocument();
    expect(screen.getByText('Nebbiolo')).toBeInTheDocument();
  });

  it('서술의 마크다운 볼드를 별표 없이 굵게 렌더링한다', () => {
    const profile: TasteProfileView = {
      active: true,
      tastingCount: 8,
      progress: 1,
      axes: { acidity: 3.3, tannin: 2.2, body: 2.7, aroma: 3.2, finish: 3.2 },
      liked: [],
      disliked: [],
      keywords: [],
      narrative: '미각은 **중간 정도의 산도(3.3)** 를 선호합니다.',
      recommendations: [],
      agreementTrend: [],
    };

    const { container } = render(<TasteProfileCard profile={profile} />);

    expect(screen.getByText('중간 정도의 산도(3.3)').tagName).toBe('STRONG');
    expect(container.textContent).not.toContain('**');
  });
});
