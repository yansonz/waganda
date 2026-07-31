/**
 * /record 1단계 — 사진 입력 경로 테스트.
 *
 * 촬영과 앨범 선택을 **따로** 제공해야 한다.
 * `capture="environment"` 가 붙은 입력은 모바일에서 카메라를 바로 열지만 앨범 선택을 막고,
 * 속성이 없는 입력은 앨범만 열린다. 하나만 두면 다른 경로가 불가능해진다.
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

describe('/record — 사진 입력 경로', () => {
  it('촬영 입력과 선택 입력을 모두 제공한다', async () => {
    render(<RecordPage />);

    await waitFor(() => expect(screen.getByTestId('label-photo-camera')).toBeInTheDocument());
    expect(screen.getByTestId('label-photo-library')).toBeInTheDocument();
  });

  it('촬영 입력에만 capture 속성이 붙는다 (선택 입력은 앨범이 열려야 한다)', async () => {
    render(<RecordPage />);

    const camera = await waitFor(() => screen.getByTestId('label-photo-camera'));
    const library = screen.getByTestId('label-photo-library');

    // 카메라를 바로 여는 것은 이 속성이다.
    expect(camera).toHaveAttribute('capture', 'environment');
    // 선택 입력에 capture 가 붙으면 앨범에서 고를 수 없다.
    expect(library).not.toHaveAttribute('capture');

    // 둘 다 이미지만 받는다.
    expect(camera).toHaveAttribute('accept', 'image/*');
    expect(library).toHaveAttribute('accept', 'image/*');
  });

  it('두 입력에 각각 접근 가능한 이름이 있다', async () => {
    render(<RecordPage />);

    await waitFor(() => expect(screen.getByLabelText('라벨 사진 촬영')).toBeInTheDocument());
    expect(screen.getByLabelText('라벨 사진 선택')).toBeInTheDocument();
  });

  it('앨범 선택 경로로도 업로드가 시작된다', async () => {
    render(<RecordPage />);

    const library = await waitFor(() => screen.getByTestId('label-photo-library'));
    const file = new File(['fake-jpeg'], 'label.jpg', { type: 'image/jpeg' });
    await userEvent.upload(library, file);

    // 사진을 넣으면 준비·업로드 단계로 전환된다(입력 화면이 사라진다).
    await waitFor(() => {
      expect(screen.queryByTestId('label-photo-library')).not.toBeInTheDocument();
    });
  });

  it('아이콘을 글리프가 아니라 인라인 SVG 로 그린다', async () => {
    const { container } = render(<RecordPage />);

    await waitFor(() => expect(screen.getByTestId('label-photo-camera')).toBeInTheDocument());

    // 글리프는 환경에 따라 두부로 깨진다(평점 별을 숫자로 대체한 것과 같은 이유).
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent ?? '').not.toMatch(/[▣▤★☆]/);
  });
});
