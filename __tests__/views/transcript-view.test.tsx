import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TranscriptView } from '@/components/tasting/TranscriptView';

/**
 * __tests__/views/transcript-view.test.tsx — 14.9 검증:
 * - 재생 위치에 해당하는 트랜스크립트 구간 강조
 * - 화자 매핑 불확실(mappingConfidence 'none')이면 실명 미표시
 */
describe('<TranscriptView>', () => {
  const segments = [
    { start: 0, end: 5, speaker: 'speaker_1' as const, text: '와 진짜 맛있다' },
    { start: 5, end: 10, speaker: 'speaker_2' as const, text: '음... 나쁘지 않네' },
  ];

  it('현재 재생 위치에 해당하는 구간에 aria-current 를 부여해 강조한다', () => {
    render(
      <TranscriptView
        segments={segments}
        currentTimeSec={6}
        mapping={{ speaker_1: 'yan', speaker_2: 'robert' }}
        mappingConfidence="high"
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).not.toHaveAttribute('aria-current');
    expect(buttons[1]).toHaveAttribute('aria-current', 'true');
  });

  it('mappingConfidence 가 none 이면 실명을 표시하지 않고 화자 번호만 표시한다', () => {
    render(<TranscriptView segments={segments} mapping={null} mappingConfidence="none" />);

    expect(screen.queryByText('Yan')).not.toBeInTheDocument();
    expect(screen.queryByText('Robert')).not.toBeInTheDocument();
    expect(screen.getByText('화자 1')).toBeInTheDocument();
    expect(screen.getByText('화자 2')).toBeInTheDocument();
  });

  it('mappingConfidence 가 high 이면 실명을 표시한다', () => {
    render(
      <TranscriptView
        segments={segments}
        mapping={{ speaker_1: 'yan', speaker_2: 'robert' }}
        mappingConfidence="high"
      />,
    );

    expect(screen.getByText('Yan')).toBeInTheDocument();
    expect(screen.getByText('Robert')).toBeInTheDocument();
  });

  it('구간이 없으면 안내 문구를 렌더링한다 (데이터 없는 상태)', () => {
    render(<TranscriptView segments={[]} mapping={null} mappingConfidence="none" />);
    expect(screen.getByRole('status')).toHaveTextContent('트랜스크립트가 없습니다');
  });
});
