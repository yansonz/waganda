/**
 * /record 1단계 — 사진 입력 테스트.
 *
 * 입력은 **하나**다. `capture` 속성을 붙이지 않는 것이 사양이다.
 * 붙이면 모바일에서 카메라만 열리고 앨범 선택이 막히며, 데스크톱에서는 무시되어
 * 파일 선택이 열린다(촬영·선택 버튼을 나눠 봤지만 데스크톱에서 두 버튼이 똑같이
 * 동작해 혼란스러웠다). 속성이 없으면 모바일 OS 가 "사진 찍기 / 라이브러리에서 선택"
 * 시트를 띄워 주므로 버튼 하나로 두 경로가 열린다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordPage from '@/app/record/page';

beforeEach(() => {
  sessionStorage.clear();
  // 입력 UI 는 세션 확인이 끝난 뒤 렌더된다. 업로드 경로까지 가는 테스트가 있으므로
  // 사전 서명·인식 응답도 함께 준다.
  const routes: Record<string, unknown> = {
    '/api/auth/session': { authenticated: true, email: 'yan@example.com' },
    '/api/labels/upload': { imageKey: 'labels/abc.jpg', uploadUrl: 'https://s3.test/put' },
    '/api/labels/analyze': {
      label: {
        recognized: true,
        name: { value: 'Château Margaux', confidence: 'high' },
        sourceUrls: [],
      },
    },
    '/api/wines': { wine: { id: 'wine-1' } },
    '/api/tastings': { tastingId: 'tasting-1' },
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://s3.test')) return new Response(null, { status: 200 });
      const key = Object.keys(routes).find((route) => url.startsWith(route));
      if (!key) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(routes[key]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/record — 사진 입력', () => {
  it('이미지만 받는 입력 하나를 제공한다', async () => {
    render(<RecordPage />);

    const input = await waitFor(() => screen.getByTestId('label-photo-input'));
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument();
  });

  it('capture 속성을 붙이지 않는다 (붙이면 앨범 선택이 막힌다)', async () => {
    render(<RecordPage />);

    const input = await waitFor(() => screen.getByTestId('label-photo-input'));
    expect(input).not.toHaveAttribute('capture');
  });

  it('사진을 넣으면 업로드 단계로 넘어간다', async () => {
    render(<RecordPage />);

    const input = await waitFor(() => screen.getByTestId('label-photo-input'));
    await userEvent.upload(input, new File(['fake-jpeg'], 'label.jpg', { type: 'image/jpeg' }));

    await waitFor(() => {
      expect(screen.queryByTestId('label-photo-input')).not.toBeInTheDocument();
    });
  });
});
