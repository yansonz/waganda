/**
 * /record 2단계 캡처 흐름 테스트.
 *
 * 1단계 — 라벨 사진: 업로드 → 인식 → 초안 와인·시음 생성 → 결과 한 줄 확인
 * 2단계 — 녹음: 와인 확인 전에는 녹음할 수 없고, 종료하면 자동 저장된다(저장 버튼 없음)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordPage from '@/app/record/page';

vi.mock('@/components/record/AudioRecorder', () => ({
  AudioRecorder: ({
    onRecordingComplete,
  }: {
    onRecordingComplete: (blob: Blob, meta: { durationSec: number; mimeType: string }) => void;
  }) => (
    <div>
      <button type="button">녹음 시작</button>
      <button
        type="button"
        onClick={() => onRecordingComplete(new Blob(['audio']), { durationSec: 1, mimeType: 'audio/webm' })}
      >
        녹음 완료
      </button>
    </div>
  ),
}));

/** 요청 URL 별로 응답을 돌려주는 fetch 스텁 */
function stubFetch(overrides: Record<string, unknown> = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];

  const routes: Record<string, unknown> = {
    '/api/auth/session': { authenticated: true, email: 'yan@example.com' },
    '/api/labels/upload': { imageKey: 'labels/abc.jpg', uploadUrl: 'https://s3.test/put' },
    '/api/labels/analyze': {
      label: {
        recognized: true,
        name: { value: 'Château Margaux', confidence: 'high' },
        vintage: { value: 2015, confidence: 'medium' },
        country: { value: '프랑스', confidence: 'high' },
        sourceUrls: [],
      },
    },
    '/api/wines': { wine: { id: 'wine-1' } },
    '/api/tastings/tasting-1/wine': { tasting: { id: 'tasting-1', wineId: 'wine-1' } },
    '/api/tastings/tasting-1/recordings': { uploadUrl: 'https://s3.test/audio-put' },
    '/api/tastings/tasting-1/analyze': { jobStatus: 'queued' },
    '/api/tastings': { tastingId: 'tasting-1' },
    ...overrides,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      // 사전 서명 PUT 은 바디가 File/Blob 이므로 문자열일 때만 JSON 으로 읽는다
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    // S3 사전 서명 업로드
    if (url.startsWith('https://s3.test')) return new Response(null, { status: 200 });

    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((route) => url.startsWith(route));
    if (!key) return new Response('not found', { status: 404 });

    const payload = routes[key];
    if (payload instanceof Response) return payload.clone();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** 파일 입력에 사진을 넣는다 */
async function attachPhoto(): Promise<void> {
  const input = screen.getByLabelText('라벨 사진 올리기') as HTMLInputElement;
  const file = new File(['fake-jpeg'], 'label.jpg', { type: 'image/jpeg' });
  await userEvent.upload(input, file);
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/record — 1단계 라벨 사진', () => {
  it('사진을 넣으면 업로드·인식을 거쳐 인식 결과를 한 줄로 보여준다', async () => {
    const { calls } = stubFetch();
    render(<RecordPage />);

    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await attachPhoto();

    await waitFor(
      () => expect(screen.getByText(/Château Margaux 2015 · 프랑스/)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    const urls = calls.map((c) => c.url);
    expect(urls).toContain('/api/labels/upload');
    expect(urls).toContain('https://s3.test/put');
    expect(urls).toContain('/api/labels/analyze');
  });

  it('인식 결과로 초안 와인을 만들고 시음을 붙인다', async () => {
    const { calls } = stubFetch();
    render(<RecordPage />);
    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await attachPhoto();

    await waitFor(() => expect(calls.some((c) => c.url === '/api/tastings')).toBe(true), {
      timeout: 5000,
    });

    const wineCall = calls.find((c) => c.url === '/api/wines');
    expect(wineCall?.body).toMatchObject({
      name: 'Château Margaux',
      vintage: 2015,
      country: '프랑스',
      draft: true,
    });

    const tastingCall = calls.find((c) => c.url === '/api/tastings');
    expect(tastingCall?.body).toMatchObject({
      wineId: 'wine-1',
      labelImageKey: 'labels/abc.jpg',
    });
  });

  it('인식에 실패하면 사진을 버리지 않고 이름만 입력하도록 전환한다', async () => {
    stubFetch({ '/api/labels/analyze': { label: { recognized: false, sourceUrls: [] } } });
    render(<RecordPage />);
    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await attachPhoto();

    await waitFor(() => expect(screen.getByLabelText('와인 이름')).toBeInTheDocument(), {
      timeout: 5000,
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/알아보지 못했습니다/), {
      timeout: 5000,
    });
  });

  it('인식에 실패해도 이미 올린 사진은 시음에 붙는다', async () => {
    const { calls } = stubFetch({
      '/api/labels/analyze': { label: { recognized: false, sourceUrls: [] } },
    });
    render(<RecordPage />);
    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await attachPhoto();

    await waitFor(() => expect(screen.getByLabelText('와인 이름')).toBeInTheDocument(), {
      timeout: 5000,
    });
    await userEvent.type(screen.getByLabelText('와인 이름'), '수동 입력 와인');
    await userEvent.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/tastings')).toBe(true), {
      timeout: 5000,
    });
    const tastingCall = calls.find((c) => c.url === '/api/tastings');
    expect(tastingCall?.body).toMatchObject({ labelImageKey: 'labels/abc.jpg' });
  });

  it('인식 서비스 오류(5xx)와 인식 실패를 구분해 안내한다', async () => {
    stubFetch({
      '/api/labels/analyze': new Response(JSON.stringify({ error: 'AGENT_UNAVAILABLE' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    });
    render(<RecordPage />);
    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await attachPhoto();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/서비스에 연결하지 못했습니다/), {
      timeout: 5000,
    });
  });

  it('사진 없이 이름만 입력해도 기록을 시작할 수 있다', async () => {
    const { calls } = stubFetch();
    render(<RecordPage />);
    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '사진 없이 이름만 입력' }));
    await userEvent.type(screen.getByLabelText('와인 이름'), '무명 내추럴');
    await userEvent.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(screen.getByText('무명 내추럴')).toBeInTheDocument());
    const wineCall = calls.find((c) => c.url === '/api/wines');
    expect(wineCall?.body).toMatchObject({ name: '무명 내추럴', draft: true });
  });

  it('같은 와인을 다시 마신 경우 기존 와인에 이어 붙인다', async () => {
    const { calls } = stubFetch({
      '/api/wines': {
        duplicateCandidates: [{ wineId: 'wine-existing', name: 'Château Margaux', vintage: 2015 }],
      },
    });
    render(<RecordPage />);
    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await attachPhoto();

    await waitFor(
      () => expect(screen.getByText('기존에 기록한 와인에 이어 붙입니다')).toBeInTheDocument(),
      { timeout: 5000 },
    );
    const tastingCall = calls.find((c) => c.url === '/api/tastings');
    expect(tastingCall?.body).toMatchObject({ wineId: 'wine-existing' });
  });
});

describe('/record — 2단계 녹음', () => {
  it('사진 전에 녹음 우선 캡처를 시작할 수 있다', async () => {
    const { calls } = stubFetch();
    render(<RecordPage />);

    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '지금 반응 녹음하기' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /녹음 시작/ })).toBeInTheDocument());
    const captureCall = calls.find((call) => call.url === '/api/tastings');
    expect(captureCall?.body).toEqual(expect.objectContaining({ tastedAt: expect.any(String) }));
    expect(captureCall?.body).not.toHaveProperty('wineId');
  });

  it('녹음 뒤 사진을 붙이면 기존 캡처에 와인을 연결한다', async () => {
    const { calls } = stubFetch();
    render(<RecordPage />);

    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '지금 반응 녹음하기' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /녹음 시작/ })).toBeInTheDocument());

    await attachPhoto();
    await waitFor(
      () => expect(screen.getByText(/Château Margaux 2015 · 프랑스/)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    const attachCall = calls.find((call) => call.url === '/api/tastings/tasting-1/wine');
    expect(attachCall?.body).toEqual({ wineId: 'wine-1', labelImageKey: 'labels/abc.jpg' });
    expect(calls.filter((call) => call.url === '/api/tastings')).toHaveLength(1);
  });

  it('녹음 먼저인 캡처에 사진을 붙이면 최종 분석을 예약한다', async () => {
    const { calls } = stubFetch();
    render(<RecordPage />);

    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '지금 반응 녹음하기' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '녹음 완료' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '녹음 완료' }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/recordings'))).toBe(true));

    await attachPhoto();
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/analyze'))).toBe(true));
    expect(calls.find((call) => call.url === '/api/tastings/tasting-1/analyze')?.body).toEqual({});
  });

  it('와인을 확인하면 녹음 컨트롤이 나타난다', async () => {
    stubFetch();
    render(<RecordPage />);
    await waitFor(() => expect(screen.getByLabelText('라벨 사진 올리기')).toBeInTheDocument());
    await attachPhoto();

    await waitFor(
      () => expect(screen.getByRole('button', { name: /녹음 시작/ })).toBeInTheDocument(),
      { timeout: 5000 },
    );
    // 저장 버튼은 두지 않는다 (녹음 종료 시 자동 저장)
    expect(screen.queryByRole('button', { name: /시음 기록 저장/ })).not.toBeInTheDocument();
  });
});
