import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscoveryCard } from '@/components/discovery/DiscoveryCard';
import type { DiscoveryView } from '@/lib/views/read';

/**
 * __tests__/views/discovery-card.test.tsx — 14.9 검증:
 * 발견 카드의 신뢰 등급(약함/보통/뚜렷함)과 우연 가능성 문구 표시.
 */
function makeDiscoveryView(overrides: Partial<DiscoveryView>): DiscoveryView {
  return {
    id: 'd1',
    alias: '웃음의 법칙',
    description: '웃음이 터진 시음은 평균 4점 이상이었습니다.',
    n: 5,
    grade: 'moderate',
    disclaimer: '표본이 적어 우연일 수 있습니다. 기록이 쌓이면 다시 판정합니다.',
    evidenceTastingIds: ['t1', 't2'],
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('<DiscoveryCard>', () => {
  it('신뢰 등급을 텍스트로 표시한다 (weak)', () => {
    render(<DiscoveryCard discovery={makeDiscoveryView({ grade: 'weak' })} />);
    expect(screen.getByText('신뢰 등급: 약함')).toBeInTheDocument();
  });

  it('신뢰 등급을 텍스트로 표시한다 (moderate)', () => {
    render(<DiscoveryCard discovery={makeDiscoveryView({ grade: 'moderate' })} />);
    expect(screen.getByText('신뢰 등급: 보통')).toBeInTheDocument();
  });

  it('신뢰 등급을 텍스트로 표시한다 (strong)', () => {
    render(<DiscoveryCard discovery={makeDiscoveryView({ grade: 'strong' })} />);
    expect(screen.getByText('신뢰 등급: 뚜렷함')).toBeInTheDocument();
  });

  it('우연 가능성 문구와 표본 수를 표시한다', () => {
    render(<DiscoveryCard discovery={makeDiscoveryView({ n: 7 })} />);
    expect(screen.getByText('표본 7건')).toBeInTheDocument();
    expect(screen.getByText(/표본이 적어 우연일 수 있습니다/)).toBeInTheDocument();
  });

  it('근거 시음 링크를 렌더링한다', () => {
    render(<DiscoveryCard discovery={makeDiscoveryView({ evidenceTastingIds: ['t1', 't2'] })} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/tastings/t1');
  });
});
