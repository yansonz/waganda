'use client';

/**
 * components/record/AudioRecorder.tsx — 음성 녹음 컨트롤 (7.1).
 *
 * requirements.md R2: "브라우저에서 마이크 녹음을 시작/일시정지/종료할 수 있는 컨트롤",
 * "녹음이 진행 중이면 경과 시간과 실시간 파형(또는 음량 레벨)을 표시".
 *
 * - MediaRecorder 로 오디오를 캡처하고, AnalyserNode 로 실시간 음량(RMS)을 측정한다.
 * - 미디어 생성(getUserMedia)과 레코더 생성(MediaRecorder)은 주입 가능하게 만들어
 *   테스트에서 jsdom 에 없는 API 를 모킹할 수 있게 한다.
 * - 녹음 완료 시 Blob 을 상위 컴포넌트로 전달한다(업로드는 상위 책임).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** 녹음 상태 전이: idle → recording → paused → recording → stopped */
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

/** 미디어 스트림 취득 함수 — 테스트에서 교체 가능 */
export type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/** MediaRecorder 인스턴스 생성 함수 — 테스트에서 교체 가능 */
export type CreateMediaRecorder = (
  stream: MediaStream,
  options?: MediaRecorderOptions,
) => MediaRecorder;

/** AudioContext 생성 함수 — 테스트에서 교체 가능 */
export type CreateAudioContext = () => AudioContext;

export interface AudioRecorderProps {
  /** 녹음이 완료되어 Blob 이 만들어지면 상위로 전달한다. */
  onRecordingComplete: (blob: Blob, meta: { durationSec: number; mimeType: string }) => void;
  /** 녹음 중 에러(마이크 권한 거부 등)를 상위에 알린다. 한국어 메시지. */
  onError?: (message: string) => void;
  /** 테스트 주입용 — 기본값은 `navigator.mediaDevices.getUserMedia`. */
  getUserMediaImpl?: GetUserMedia;
  /** 테스트 주입용 — 기본값은 `new MediaRecorder(...)`. */
  createMediaRecorderImpl?: CreateMediaRecorder;
  /** 테스트 주입용 — 기본값은 `new AudioContext()`. */
  createAudioContextImpl?: CreateAudioContext;
  /** MediaRecorder 에 넘길 MIME 타입 (기본 audio/webm) */
  mimeType?: string;
  /** 음량 레벨 갱신 주기(ms). 기본 100ms. */
  levelUpdateIntervalMs?: number;
}

const DEFAULT_MIME_TYPE = 'audio/webm';
const DEFAULT_LEVEL_INTERVAL_MS = 100;

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(constraints);
}

function defaultCreateMediaRecorder(
  stream: MediaStream,
  options?: MediaRecorderOptions,
): MediaRecorder {
  return new MediaRecorder(stream, options);
}

function defaultCreateAudioContext(): AudioContext {
  return new AudioContext();
}

/** 경과 시간(초)을 `mm:ss` 형태로 표시한다. */
export function formatElapsedTime(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** AnalyserNode 의 시간 도메인 데이터로 RMS(0~1) 음량을 계산한다. */
export function computeRmsLevel(timeDomainData: Uint8Array): number {
  if (timeDomainData.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < timeDomainData.length; i += 1) {
    const normalized = (timeDomainData[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / timeDomainData.length);
}

/**
 * 음성 녹음 컨트롤 컴포넌트.
 *
 * 접근성: 모든 버튼에 명시적 텍스트 라벨을 제공하고, 경과 시간·음량은
 * `role="status"`/`aria-live="polite"` 영역과 `role="progressbar"` 로 시각·비시각 사용자
 * 모두에게 전달한다(색상에만 의존하지 않음).
 */
export function AudioRecorder({
  onRecordingComplete,
  onError,
  getUserMediaImpl = defaultGetUserMedia,
  createMediaRecorderImpl = defaultCreateMediaRecorder,
  createAudioContextImpl = defaultCreateAudioContext,
  mimeType = DEFAULT_MIME_TYPE,
  levelUpdateIntervalMs = DEFAULT_LEVEL_INTERVAL_MS,
}: AudioRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [level, setLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const pausedAccumRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelTimerRef.current !== null) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
  }, []);

  const cleanupMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close?.();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    recorderRef.current = null;
  }, []);

  // 언마운트 시 자원 정리 — 마이크 스트림과 타이머가 계속 살아있지 않게 한다.
  useEffect(() => {
    return () => {
      clearTimers();
      cleanupMedia();
    };
  }, [clearTimers, cleanupMedia]);

  const startLevelMonitoring = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buffer = new Uint8Array(analyser.fftSize);
    levelTimerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      setLevel(computeRmsLevel(buffer));
    }, levelUpdateIntervalMs);
  }, [levelUpdateIntervalMs]);

  const startElapsedTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = pausedAccumRef.current + (now - startedAtRef.current) / 1000;
      setElapsedSec(elapsed);
    }, 200);
  }, []);

  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    try {
      const stream = await getUserMediaImpl({ audio: true });
      streamRef.current = stream;

      const audioContext = createAudioContextImpl();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = createMediaRecorderImpl(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationSec = pausedAccumRef.current + (Date.now() - startedAtRef.current) / 1000;
        onRecordingComplete(blob, { durationSec, mimeType });
      };

      recorder.start();
      startedAtRef.current = Date.now();
      pausedAccumRef.current = 0;
      setElapsedSec(0);
      setState('recording');
      startElapsedTimer();
      startLevelMonitoring();
    } catch {
      const message =
        '마이크에 접근할 수 없습니다. 브라우저의 마이크 권한을 허용했는지 확인해 주세요.';
      setErrorMessage(message);
      onError?.(message);
      cleanupMedia();
    }
  }, [
    getUserMediaImpl,
    createAudioContextImpl,
    createMediaRecorderImpl,
    mimeType,
    onRecordingComplete,
    onError,
    cleanupMedia,
    startElapsedTimer,
    startLevelMonitoring,
  ]);

  const handlePause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || state !== 'recording') return;
    recorder.pause();
    pausedAccumRef.current += (Date.now() - startedAtRef.current) / 1000;
    clearTimers();
    setLevel(0);
    setState('paused');
  }, [state, clearTimers]);

  const handleResume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || state !== 'paused') return;
    recorder.resume();
    startedAtRef.current = Date.now();
    setState('recording');
    startElapsedTimer();
    startLevelMonitoring();
  }, [state, startElapsedTimer, startLevelMonitoring]);

  const handleStop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || (state !== 'recording' && state !== 'paused')) return;
    clearTimers();
    setLevel(0);
    recorder.stop();
    cleanupMedia();
    setState('stopped');
  }, [state, clearTimers, cleanupMedia]);

  const handleRestart = useCallback(() => {
    clearTimers();
    cleanupMedia();
    chunksRef.current = [];
    pausedAccumRef.current = 0;
    setElapsedSec(0);
    setLevel(0);
    setState('idle');
  }, [clearTimers, cleanupMedia]);

  const levelPercent = Math.round(Math.min(1, level) * 100);

  return (
    <div className="card p-4 space-y-3" data-testid="audio-recorder">
      <div className="flex items-center justify-between gap-3">
        <span
          role="status"
          aria-live="polite"
          className="font-mono text-lg text-cream-100"
          data-testid="elapsed-time"
        >
          {formatElapsedTime(elapsedSec)}
        </span>
        <span className="text-sm text-muted" data-testid="recorder-state">
          {state === 'idle' && '대기 중'}
          {state === 'recording' && '녹음 중'}
          {state === 'paused' && '일시정지'}
          {state === 'stopped' && '녹음 완료'}
        </span>
      </div>

      <div>
        <div
          role="progressbar"
          aria-label="실시간 음량 레벨"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={levelPercent}
          className="h-3 w-full overflow-hidden rounded-full bg-ink-950"
        >
          <div
            className="h-full bg-gold-500 transition-[width] duration-100"
            style={{ width: `${levelPercent}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-muted">음량 레벨: {levelPercent}%</p>
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-burgundy-300">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {state === 'idle' && (
          <button
            type="button"
            onClick={handleStart}
            aria-label="녹음 시작"
            className="rounded-md bg-burgundy-700 px-4 py-2 text-sm font-medium text-cream-50"
          >
            녹음 시작
          </button>
        )}

        {state === 'recording' && (
          <>
            <button
              type="button"
              onClick={handlePause}
              aria-label="녹음 일시정지"
              className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-cream-100"
            >
              일시정지
            </button>
            <button
              type="button"
              onClick={handleStop}
              aria-label="녹음 종료"
              className="rounded-md bg-burgundy-700 px-4 py-2 text-sm font-medium text-cream-50"
            >
              종료
            </button>
          </>
        )}

        {state === 'paused' && (
          <>
            <button
              type="button"
              onClick={handleResume}
              aria-label="녹음 재시작"
              className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-cream-100"
            >
              재시작
            </button>
            <button
              type="button"
              onClick={handleStop}
              aria-label="녹음 종료"
              className="rounded-md bg-burgundy-700 px-4 py-2 text-sm font-medium text-cream-50"
            >
              종료
            </button>
          </>
        )}

        {state === 'stopped' && (
          <button
            type="button"
            onClick={handleRestart}
            aria-label="새로 녹음하기"
            className="rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-cream-100"
          >
            새로 녹음하기
          </button>
        )}
      </div>
    </div>
  );
}
