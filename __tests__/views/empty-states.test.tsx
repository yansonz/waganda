import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotesRadar } from '@/components/tasting/NotesRadar';
import { EmotionTimeline } from '@/components/tasting/EmotionTimeline';
import { RatingTrend } from '@/components/wine/RatingTrend';
import { AgreementTrend } from '@/components/profile/AgreementTrend';
import { EmptyState } from '@/components/common/EmptyState';

/**
 * __tests__/views/empty-states.test.tsx — 14.9 검증:
 * 데이터 없는 상태(기록 0건)에서도 각 차트/카드 컴포넌트가 오류 없이 렌더링되는지 확인한다.
 */
describe('데이터 없는 상태 렌더링', () => {
  it('EmptyState 는 제목과 설명을 role=status 로 렌더링한다', () => {
    render(<EmptyState title="아직 기록이 없어요" description="첫 기록을 남겨보세요" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('아직 기록이 없어요');
    expect(status).toHaveTextContent('첫 기록을 남겨보세요');
  });

  it('NotesRadar 는 값이 비어 있어도 오류 없이 렌더링된다', () => {
    render(<NotesRadar values={{}} />);
    expect(screen.getAllByText('산미').length).toBeGreaterThan(0);
    expect(screen.getAllByText('값 없음').length).toBe(5);
  });

  it('EmotionTimeline 은 포인트가 없으면 안내 문구를 표시한다', () => {
    render(<EmotionTimeline points={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('감정 타임라인 데이터가 없습니다');
  });

  it('RatingTrend 는 포인트가 없으면 안내 문구를 표시한다', () => {
    render(<RatingTrend points={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('평점 추이 데이터가 없습니다');
  });

  it('AgreementTrend 는 포인트가 없으면 안내 문구를 표시한다', () => {
    render(<AgreementTrend points={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('반응 일치도 데이터가 없습니다');
  });
});
