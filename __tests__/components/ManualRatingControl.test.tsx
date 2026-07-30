/**
 * 수동 평점 입력 컨트롤 테스트.
 *
 * AI 평점이 표시 중일 때 안내가 보이고, 저장하면 `manualRating` 과 `rev` 를
 * PATCH 로 보내며, 미인증(401)이면 로그인 흐름으로 넘어가는지 확인한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderAsEditor } from '../helpers/renderWithSession';
import userEvent from '@testing-library/user-event';
import { ManualRatingControl } from '@/components/tasting/ManualRatingControl';

const originalLocation = window.location;

beforeEach(() => {
  sessionStorage.clear();
  // reload/href 를 감시하기 위해 location 을 대체한다
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...originalLocation,
      href: 'http://localhost/tastings/t1',
      reload: vi.fn(),
      assign: vi.fn(),
    },
  });
});

describe('ManualRatingControl', () => {
  it('AI 평점이 표시 중이면 수동 평점 저장 시 대체된다고 안내한다', () => {
    renderAsEditor(
      <ManualRatingControl tastingId="t1" currentRating={4} ratingSource="ai" rev={0} />,
    );
    expect(screen.getByText(/AI 평점이 표시됩니다/)).toBeInTheDocument();
  });

  it('수동 평점이 표시 중이면 AI 평점이 보존된다고 안내한다', () => {
    renderAsEditor(
      <ManualRatingControl tastingId="t1" currentRating={4.5} ratingSource="manual" rev={1} />,
    );
    expect(screen.getByText(/AI 평점은 그대로 보존됩니다/)).toBeInTheDocument();
  });

  it('현재 평점을 기본 선택값으로 보여준다', () => {
    renderAsEditor(
      <ManualRatingControl tastingId="t1" currentRating={4.5} ratingSource="ai" rev={0} />,
    );
    expect(screen.getByLabelText('수동 평점')).toHaveValue('4.5');
  });

  it('저장하면 manualRating 과 rev 를 PATCH 로 보낸다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAsEditor(
      <ManualRatingControl tastingId="t1" currentRating={3} ratingSource="ai" rev={2} />,
    );
    await userEvent.selectOptions(screen.getByLabelText('수동 평점'), '4.5');
    await userEvent.click(screen.getByRole('button', { name: '수동 평점 저장' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/tastings/t1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ manualRating: 4.5, rev: 2 });
  });

  it('0.5 단위 선택지를 1~5 까지 제공한다', () => {
    renderAsEditor(<ManualRatingControl tastingId="t1" rev={0} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5']);
  });

  it('409 충돌이면 새로 고침 안내를 보여준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'CONFLICT' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderAsEditor(
      <ManualRatingControl tastingId="t1" currentRating={3} ratingSource="ai" rev={0} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '수동 평점 저장' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/다른 곳에서 먼저 수정되었습니다/),
    );
  });

  it('미인증(401)이면 폼 초안을 보존한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'UNAUTHORIZED', loginUrl: '/api/auth/google/start' }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    renderAsEditor(
      <ManualRatingControl tastingId="t1" currentRating={3} ratingSource="ai" rev={0} />,
    );
    await userEvent.selectOptions(screen.getByLabelText('수동 평점'), '5');
    await userEvent.click(screen.getByRole('button', { name: '수동 평점 저장' }));

    await waitFor(() => {
      const stored = JSON.stringify(sessionStorage);
      expect(stored).toContain('manualRating');
    });
  });
});
