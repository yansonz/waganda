/**
 * 쓰기 UI 노출 정책 테스트.
 *
 * 정책(사용자 결정으로 변경됨): **로그인해야 수정·삭제 같은 쓰기 UI 가 보인다.**
 * 비로그인 방문자는 열람만 하고, 우상단 로그인 진입점만 노출된다.
 *
 * 참고: `.kiro/specs/mvp` 의 R1/14.7 은 원래 "컨트롤을 항상 렌더링하고 클릭 시 로그인 전환"
 * 이었다. 이 테스트가 변경된 정책을 고정한다.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { EditorOnly } from '@/components/auth/EditorSession';
import { LoginButton } from '@/components/auth/LoginButton';
import { TastingEditControls } from '@/components/tasting/TastingEditControls';
import { ManualRatingControl } from '@/components/tasting/ManualRatingControl';
import { renderAsEditor, renderAsVisitor } from '../helpers/renderWithSession';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tastings/t1',
}));

describe('쓰기 UI 노출 — 비로그인 방문자', () => {
  it('시음 수정·삭제 컨트롤이 보이지 않는다', () => {
    renderAsVisitor(<TastingEditControls tastingId="t1" wineName="테스트 와인" rev={0} />);
    expect(screen.queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /수정/ })).not.toBeInTheDocument();
  });

  it('수동 평점 입력 컨트롤이 보이지 않는다', () => {
    renderAsVisitor(<ManualRatingControl tastingId="t1" currentRating={4} ratingSource="ai" rev={0} />);
    expect(screen.queryByLabelText('수동 평점')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수동 평점 저장' })).not.toBeInTheDocument();
  });

  it('우상단에 로그인 링크가 보이고 현재 경로로 돌아온다', () => {
    renderAsVisitor(<LoginButton />);
    const link = screen.getByRole('link', { name: '로그인' });
    expect(link).toHaveAttribute(
      'href',
      '/api/auth/google/start?returnTo=%2Ftastings%2Ft1',
    );
  });

  it('로그아웃 링크는 보이지 않는다', () => {
    renderAsVisitor(<LoginButton />);
    expect(screen.queryByRole('link', { name: '로그아웃' })).not.toBeInTheDocument();
  });
});

describe('쓰기 UI 노출 — 로그인한 편집자', () => {
  it('시음 수정·삭제 컨트롤이 보인다', () => {
    renderAsEditor(<TastingEditControls tastingId="t1" wineName="테스트 와인" rev={0} />);
    expect(screen.getByRole('button', { name: /삭제/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /수정/ })).toBeInTheDocument();
  });

  it('수동 평점 입력 컨트롤이 보인다', () => {
    renderAsEditor(<ManualRatingControl tastingId="t1" currentRating={4} ratingSource="ai" rev={0} />);
    expect(screen.getByLabelText('수동 평점')).toBeInTheDocument();
  });

  it('우상단에 이메일과 로그아웃이 보인다', () => {
    renderAsEditor(<LoginButton />, 'robert@example.com');
    expect(screen.getByText('robert@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '로그아웃' })).toHaveAttribute('href', '/api/auth/logout');
  });
});

describe('세션 조회 중', () => {
  it('조회가 끝나기 전에는 쓰기 UI 를 그리지 않는다 (깜빡임·오노출 방지)', async () => {
    // fetch 를 영원히 보류시켜 loaded=false 상태를 유지한다
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { EditorSessionProvider } = await import('@/components/auth/EditorSession');
    const { render } = await import('@testing-library/react');

    render(
      <EditorSessionProvider>
        <EditorOnly>
          <button type="button">삭제</button>
        </EditorOnly>
      </EditorSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
    });
  });

  it('세션 조회가 실패하면 비로그인으로 취급한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { EditorSessionProvider } = await import('@/components/auth/EditorSession');
    const { render } = await import('@testing-library/react');

    render(
      <EditorSessionProvider>
        <EditorOnly fallback={<span>열람 전용</span>}>
          <button type="button">삭제</button>
        </EditorOnly>
      </EditorSessionProvider>,
    );

    await waitFor(() => expect(screen.getByText('열람 전용')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
  });
});
