import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditActionButton } from '@/components/common/EditActionButton';

/**
 * __tests__/views/edit-action-button.test.tsx — 14.9 검증:
 * 미인증 방문자에게 편집 컨트롤이 렌더링되고 클릭 시 로그인 흐름으로 전환되는지 확인한다.
 * (session 유무를 확인하지 않고 항상 렌더링 — R1/R9)
 */
describe('<EditActionButton>', () => {
  it('세션 여부와 무관하게 항상 렌더링된다', () => {
    render(
      <EditActionButton
        formId="test-form"
        endpoint="/api/tastings/t1"
        method="DELETE"
        ariaLabel="삭제"
      >
        삭제
      </EditActionButton>,
    );

    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });

  it('삭제 요청이 실패하면 API의 오류 사유를 표시한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: '삭제 권한이 없습니다.' }), { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    render(
      <EditActionButton
        formId="test-form-error"
        endpoint="/api/tastings/t1"
        method="DELETE"
        ariaLabel="삭제"
      >
        삭제
      </EditActionButton>,
    );

    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('삭제 권한이 없습니다.');
    vi.unstubAllGlobals();
  });

  it('클릭 시 401 UNAUTHORIZED 응답을 받으면 로그인 화면으로 이동한다', async () => {
    const loginUrl = '/api/auth/google/start?returnTo=%2Ftastings%2Ft1';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'UNAUTHORIZED', loginUrl }), { status: 401 }),
      ),
    );

    const hrefSetter = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: '/tastings/t1',
        get href() {
          return originalLocation.href;
        },
        set href(value: string) {
          hrefSetter(value);
        },
      },
    });

    const user = userEvent.setup();
    render(
      <EditActionButton
        formId="test-form-2"
        endpoint="/api/tastings/t1"
        method="DELETE"
        ariaLabel="삭제"
      >
        삭제
      </EditActionButton>,
    );

    await user.click(screen.getByRole('button', { name: '삭제' }));

    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith(loginUrl);
    });

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
  });
});
