import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderAsEditor } from '../helpers/renderWithSession';
import userEvent from '@testing-library/user-event';
import type { JobStatus } from '@waganda/schemas';
import { AnalysisStatus } from '@/components/tasting/AnalysisStatus';

/**
 * components/tasting/AnalysisStatus.tsx 테스트 (10.9 UI 부분).
 *
 * 상태별 조건부 렌더링, 완료 시 자동 갱신(폴링 + 언마운트 정리), 브라우저 알림
 * (권한 있을 때만, 없으면 조용히 생략), 재분석 버튼의 useWriteAction 연동을 검증한다.
 *
 * jsdom 에는 Notification 이 없으므로 vi.stubGlobal 로 주입한다 (vitest.setup.ts 는 수정하지 않음).
 */

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  title: string;
  body?: string;
  constructor(title: string, options?: { body?: string }) {
    this.title = title;
    this.body = options?.body;
    FakeNotification.instances.push(this);
  }
  static instances: FakeNotification[] = [];
}

function makeFetchStatus(sequence: JobStatus[]) {
  let index = 0;
  return vi.fn(async () => {
    const status = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    return { status };
  });
}

beforeEach(() => {
  FakeNotification.instances = [];
  FakeNotification.permission = 'granted';
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('<AnalysisStatus> 상태별 조건부 렌더링', () => {
  it.each<[JobStatus, string]>([
    ['queued', '대기 중'],
    ['transcribing', '음성 변환 중'],
    ['analyzing', '분석 중'],
    ['completed', '분석 완료'],
    ['failed', '분석 실패'],
  ])('%s 상태에서 "%s" 를 표시한다', async (status, label) => {
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus={status}
        fetchStatus={makeFetchStatus([status])}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );
    expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-status', status);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('진행 중 상태에는 예상 소요 시간을 표시한다', () => {
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="transcribing"
        fetchStatus={makeFetchStatus(['transcribing'])}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );
    expect(screen.getByText(/예상 소요 시간/)).toBeInTheDocument();
  });

  it('completed/failed 상태에는 예상 소요 시간을 표시하지 않는다', () => {
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="completed"
        fetchStatus={makeFetchStatus(['completed'])}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );
    expect(screen.queryByText(/예상 소요 시간/)).not.toBeInTheDocument();
  });

  it('failed 상태에는 재분석 버튼을 표시한다', () => {
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="failed"
        fetchStatus={makeFetchStatus(['failed'])}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );
    expect(screen.getByRole('button', { name: '재분석 요청' })).toBeInTheDocument();
  });

  it('진행 중 상태에는 재분석 버튼이 없다', () => {
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="analyzing"
        fetchStatus={makeFetchStatus(['analyzing'])}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );
    expect(screen.queryByRole('button', { name: '재분석 요청' })).not.toBeInTheDocument();
  });
});

describe('<AnalysisStatus> 폴링과 완료 시 갱신', () => {
  it('진행 중 상태에서는 주기적으로 상태를 다시 조회한다', async () => {
    const fetchStatus = makeFetchStatus(['queued', 'queued', 'queued']);
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="queued"
        fetchStatus={fetchStatus}
        pollIntervalMs={1000}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchStatus).toHaveBeenCalled();
  });

  it('완료가 감지되면 onCompleted 콜백을 1회 호출하고 알림을 보낸다', async () => {
    const fetchStatus = makeFetchStatus(['completed']);
    const onCompleted = vi.fn();

    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="queued"
        fetchStatus={fetchStatus}
        onCompleted={onCompleted}
        pollIntervalMs={1000}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      // fetchStatus 의 프로미스 체인(.then)이 처리될 마이크로태스크를 한 번 더 흘려보낸다.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-status', 'completed');

    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toContain('와간다');
  });

  it('완료된 상태로 시작하면 폴링하지 않는다', () => {
    const fetchStatus = makeFetchStatus(['completed']);
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="completed"
        fetchStatus={fetchStatus}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('언마운트되면 폴링 타이머가 정리된다', async () => {
    const fetchStatus = makeFetchStatus(['queued', 'queued', 'queued']);
    const { unmount } = renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="queued"
        fetchStatus={fetchStatus}
        pollIntervalMs={1000}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );

    unmount();
    const callsAfterUnmount = fetchStatus.mock.calls.length;

    await vi.advanceTimersByTimeAsync(5000);

    // 언마운트 후에는 추가 호출이 없어야 한다.
    expect(fetchStatus.mock.calls.length).toBe(callsAfterUnmount);
  });

  it('알림 권한이 없으면 알림을 생략한다(요청하지 않음)', async () => {
    FakeNotification.permission = 'default';
    const fetchStatus = makeFetchStatus(['completed']);

    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="queued"
        fetchStatus={fetchStatus}
        pollIntervalMs={1000}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-status', 'completed');
    expect(FakeNotification.instances).toHaveLength(0);
  });
});

describe('<AnalysisStatus> 재분석 버튼 — useWriteAction', () => {
  it('재분석 버튼을 클릭하면 POST /api/tastings/{id}/analyze 를 호출한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ jobStatus: 'queued' }), { status: 200 })),
    );
    vi.useRealTimers();

    const user = userEvent.setup();
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="failed"
        fetchStatus={makeFetchStatus(['failed'])}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );

    await user.click(screen.getByRole('button', { name: '재분석 요청' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/tastings/t1/analyze',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('미인증(401)이면 로그인 URL 로 이동을 시도한다', async () => {
    const loginUrl = '/api/auth/google/start?returnTo=%2Frecord';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'UNAUTHORIZED', loginUrl }), { status: 401 }),
        ),
    );
    vi.useRealTimers();

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
    renderAsEditor(
      <AnalysisStatus
        tastingId="t1"
        initialStatus="failed"
        fetchStatus={makeFetchStatus(['failed'])}
        notificationApi={FakeNotification as unknown as typeof Notification}
      />,
    );

    await user.click(screen.getByRole('button', { name: '재분석 요청' }));

    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith(loginUrl);
    });

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });
});
