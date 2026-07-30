import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AudioRecorder,
  computeRmsLevel,
  formatElapsedTime,
} from '@/components/record/AudioRecorder';

/**
 * components/record/AudioRecorder.tsx 테스트 (7.7).
 *
 * jsdom 에는 MediaRecorder/AudioContext/getUserMedia 가 없으므로,
 * 컴포넌트가 지원하는 주입 지점(getUserMediaImpl/createMediaRecorderImpl/
 * createAudioContextImpl)을 통해 목(mock) 구현을 전달한다. vitest.setup.ts 는 수정하지 않는다.
 */

/** 테스트용 가짜 MediaRecorder — 상태 전이와 dataavailable/stop 이벤트를 모사한다. */
class FakeMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(public stream: MediaStream) {}

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function createFakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
}

function createFakeAnalyser(): AnalyserNode {
  return {
    fftSize: 2048,
    getByteTimeDomainData: (buffer: Uint8Array) => {
      buffer.fill(128); // 무음(레벨 0)을 흉내
    },
  } as unknown as AnalyserNode;
}

function createFakeAudioContext(): AudioContext {
  const analyser = createFakeAnalyser();
  return {
    createMediaStreamSource: () => ({ connect: vi.fn() }),
    createAnalyser: () => analyser,
    close: vi.fn(),
  } as unknown as AudioContext;
}

describe('formatElapsedTime', () => {
  it('초를 mm:ss 형식으로 표시한다', () => {
    expect(formatElapsedTime(0)).toBe('00:00');
    expect(formatElapsedTime(65)).toBe('01:05');
    expect(formatElapsedTime(3599)).toBe('59:59');
  });
});

describe('computeRmsLevel', () => {
  it('무음(128 로 채워진 버퍼)은 0에 가까운 값을 반환한다', () => {
    const buffer = new Uint8Array(1024).fill(128);
    expect(computeRmsLevel(buffer)).toBeCloseTo(0, 5);
  });

  it('최대 진폭(0 과 255 교차)은 1에 가까운 값을 반환한다', () => {
    const buffer = new Uint8Array(1024);
    for (let i = 0; i < buffer.length; i += 1) {
      buffer[i] = i % 2 === 0 ? 0 : 255;
    }
    expect(computeRmsLevel(buffer)).toBeGreaterThan(0.9);
  });

  it('빈 버퍼는 0을 반환한다', () => {
    expect(computeRmsLevel(new Uint8Array(0))).toBe(0);
  });
});

describe('<AudioRecorder> 상태 전이', () => {
  function setup() {
    const onRecordingComplete = vi.fn();
    const getUserMediaImpl = vi.fn().mockResolvedValue(createFakeStream());
    const createMediaRecorderImpl = vi.fn(
      (stream: MediaStream) => new FakeMediaRecorder(stream) as unknown as MediaRecorder,
    );
    const createAudioContextImpl = vi.fn(() => createFakeAudioContext());

    render(
      <AudioRecorder
        onRecordingComplete={onRecordingComplete}
        getUserMediaImpl={getUserMediaImpl}
        createMediaRecorderImpl={createMediaRecorderImpl}
        createAudioContextImpl={createAudioContextImpl}
      />,
    );

    return { onRecordingComplete, getUserMediaImpl };
  }

  it('시작 → 일시정지 → 종료 상태 전이가 올바르게 렌더링된다', async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.getByTestId('recorder-state')).toHaveTextContent('대기 중');

    await user.click(screen.getByRole('button', { name: '녹음 시작' }));
    await waitFor(() => {
      expect(screen.getByTestId('recorder-state')).toHaveTextContent('녹음 중');
    });

    await user.click(screen.getByRole('button', { name: '녹음 일시정지' }));
    expect(screen.getByTestId('recorder-state')).toHaveTextContent('일시정지');

    await user.click(screen.getByRole('button', { name: '녹음 종료' }));
    expect(screen.getByTestId('recorder-state')).toHaveTextContent('녹음 완료');
  });

  it('녹음 종료 시 Blob 을 상위로 전달한다', async () => {
    const user = userEvent.setup();
    const { onRecordingComplete } = setup();

    await user.click(screen.getByRole('button', { name: '녹음 시작' }));
    await waitFor(() => screen.getByRole('button', { name: '녹음 종료' }));
    await user.click(screen.getByRole('button', { name: '녹음 종료' }));

    expect(onRecordingComplete).toHaveBeenCalledTimes(1);
    const [blob, meta] = onRecordingComplete.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(meta.mimeType).toBe('audio/webm');
    expect(typeof meta.durationSec).toBe('number');
  });

  it('경과 시간이 role=status 로 노출된다', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: '녹음 시작' }));
    const elapsed = screen.getByTestId('elapsed-time');
    expect(elapsed).toHaveAttribute('aria-live', 'polite');
  });

  it('음량 레벨이 role=progressbar 로 노출된다(색상 외 수단)', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: '녹음 시작' }));
    const progress = screen.getByRole('progressbar', { name: '실시간 음량 레벨' });
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
  });

  it('마이크 권한이 거부되면 한국어 에러 메시지를 표시한다', async () => {
    const user = userEvent.setup();
    const onRecordingComplete = vi.fn();
    const onError = vi.fn();
    const getUserMediaImpl = vi.fn().mockRejectedValue(new Error('NotAllowedError'));

    render(
      <AudioRecorder
        onRecordingComplete={onRecordingComplete}
        onError={onError}
        getUserMediaImpl={getUserMediaImpl}
      />,
    );

    await user.click(screen.getByRole('button', { name: '녹음 시작' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/마이크/);
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('마이크'));
  });

  it('새로 녹음하기를 누르면 idle 상태로 돌아간다', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: '녹음 시작' }));
    await waitFor(() => screen.getByRole('button', { name: '녹음 종료' }));
    await user.click(screen.getByRole('button', { name: '녹음 종료' }));

    await user.click(screen.getByRole('button', { name: '새로 녹음하기' }));
    expect(screen.getByTestId('recorder-state')).toHaveTextContent('대기 중');
  });
});
