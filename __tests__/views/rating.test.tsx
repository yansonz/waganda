/**
 * 평점 표기 회귀 테스트.
 *
 * 배경: 0.5 단위 평점을 별 아이콘으로 그리려면 반쪽 별 글리프가 필요한데
 * 유니코드 반별(U+2BEA 등)은 지원 폰트가 적어 두부(□)로 깨져 보였다.
 * 그래서 숫자만 표시하기로 했고, 별 글리프가 다시 들어오지 않도록 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Rating } from '@/components/common/Rating';

/** 별·반별로 쓰일 수 있는 글리프 목록 */
const STAR_GLYPHS = ['★', '☆', '⯪', '⯨', '✩', '✭', '⭐', '½'];

describe('Rating', () => {
  it('4.5 는 소수점까지 숫자로 표시한다', () => {
    render(<Rating value={4.5} />);
    expect(screen.getByText('4.5')).toBeInTheDocument();
  });

  it('정수 평점은 불필요한 소수점을 붙이지 않는다', () => {
    render(<Rating value={4} />);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('4.0')).not.toBeInTheDocument();
  });

  it('별 글리프를 렌더링하지 않는다', () => {
    const { container } = render(<Rating value={4.5} />);
    const text = container.textContent ?? '';
    for (const glyph of STAR_GLYPHS) {
      expect(text, `별 글리프(${glyph})가 포함되어 있다`).not.toContain(glyph);
    }
  });

  it('만점 정보를 함께 보여준다', () => {
    const { container } = render(<Rating value={3.5} />);
    expect(container.textContent).toContain('/ 5');
  });

  it('스크린리더에 출처와 만점을 함께 전달한다', () => {
    render(<Rating value={4.5} label="AI 평점" />);
    expect(screen.getByLabelText('AI 평점 4.5점 (5점 만점)')).toBeInTheDocument();
  });

  it('출처 라벨이 없으면 점수만 접근성 이름으로 제공한다', () => {
    render(<Rating value={2.5} />);
    expect(screen.getByLabelText('2.5점 (5점 만점)')).toBeInTheDocument();
  });

  it('0.5 단위 전 구간을 정확히 표기한다', () => {
    for (const value of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      const { container, unmount } = render(<Rating value={value} />);
      const expected = Number.isInteger(value) ? String(value) : value.toFixed(1);
      expect(container.textContent, `${value} 표기`).toContain(expected);
      unmount();
    }
  });
});
