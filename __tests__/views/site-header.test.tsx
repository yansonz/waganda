/**
 * 헤더 내비게이션 구성 테스트.
 *
 * - 홈(대시보드)은 좌측 "와간다" 로고가 담당한다 → 탭으로 중복 노출하지 않는다.
 * - 기록(`/record`)은 쓰기 화면이므로 로그인한 편집자에게만 노출한다.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { renderAsEditor, renderAsVisitor } from '../helpers/renderWithSession';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

describe('SiteHeader', () => {
  it('홈 링크는 로고 하나뿐이고 "대시보드" 탭은 없다', () => {
    renderAsVisitor(<SiteHeader />);

    expect(screen.getByRole('link', { name: '와간다 홈으로 이동' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '대시보드' })).not.toBeInTheDocument();

    // href="/" 인 링크가 중복되지 않는다
    const homeLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/');
    expect(homeLinks).toHaveLength(1);
  });

  it('열람 탭 4개를 노출하고 탐색 탭은 두지 않는다', () => {
    renderAsVisitor(<SiteHeader />);
    for (const label of ['와인', '타임라인', '랭킹', '발견']) {
      expect(screen.getByRole('link', { name: label }), label).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: '탐색' })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/explore'),
    ).toHaveLength(0);
  });

  it('비로그인에게는 기록 링크를 노출하지 않는다', () => {
    renderAsVisitor(<SiteHeader />);
    expect(screen.queryByRole('link', { name: '기록' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '로그인' })).toBeInTheDocument();
  });

  it('로그인한 편집자에게는 기록 링크를 노출한다', () => {
    renderAsEditor(<SiteHeader />);
    expect(screen.getByRole('link', { name: '기록' })).toHaveAttribute('href', '/record');
    expect(screen.getByRole('link', { name: '로그아웃' })).toBeInTheDocument();
  });
});
