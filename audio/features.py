"""음향 특징 추출 함수 모음.

`packages/schemas/src/recording.ts` 의 `Acoustic` 스키마와 1:1 대응하는
필드들을 계산한다. 각 함수는 16kHz 모노로 정규화된 WAV 파형(numpy 배열)을
입력으로 받아 순수하게 동작하며, 파일 I/O나 S3 접근을 하지 않는다.

Acoustic 스키마 필드:
    rmsCurve: number[]
    frameSec: number
    f0Track: {t, hz}[]
    silences: {start, end}[]
    speechRate: number
    laughterCandidates: {start, end}[]
    durationSec: number
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional, TypedDict

import numpy as np

logger = logging.getLogger(__name__)

# 분석에 사용하는 프레임 파라미터 (RMS·에너지 진동 계산 공통 기준)
FRAME_SEC = 0.025  # 25ms 프레임
HOP_SEC = 0.010  # 10ms 홉 (프레임 간격은 rmsCurve 상에서 이 값을 사용)

# 침묵 판정 기준
SILENCE_MIN_DURATION_SEC = 0.8
# RMS 임계값은 절대치가 아니라 파일 전체 RMS 대비 상대 비율로 정한다.
# (녹음 환경/기기 게인 차이에 덜 취약하다)
SILENCE_RMS_RATIO = 0.15

# 웃음 후보 탐지 파라미터
LAUGHTER_MIN_DURATION_SEC = 0.3
LAUGHTER_MAX_DURATION_SEC = 4.0


class TimeRange(TypedDict):
    start: float
    end: float


class F0Point(TypedDict):
    t: float
    hz: float


@dataclass
class VoicedSegment:
    """유성(발화) 구간 — speech_rate, laughter_candidates 계산에 재사용."""

    start: float
    end: float


def _frame_starts(num_samples: int, sample_rate: int, hop_sec: float) -> np.ndarray:
    """홉 간격 기준 프레임 시작 인덱스 배열을 만든다."""
    hop = max(1, int(round(hop_sec * sample_rate)))
    if num_samples <= 0:
        return np.array([], dtype=np.int64)
    return np.arange(0, num_samples, hop, dtype=np.int64)


def rms_curve(samples: np.ndarray, sample_rate: int, frame_sec: float = HOP_SEC) -> tuple[List[float], float]:
    """프레임 단위 RMS 에너지 곡선을 계산한다.

    Returns:
        (rmsCurve, frameSec) 튜플. frameSec 은 실제 사용된 홉 간격(초).
    """
    if samples.size == 0:
        return [], frame_sec

    win = max(1, int(round(FRAME_SEC * sample_rate)))
    starts = _frame_starts(samples.size, sample_rate, frame_sec)

    curve: List[float] = []
    for s in starts:
        end = min(s + win, samples.size)
        chunk = samples[s:end]
        if chunk.size == 0:
            curve.append(0.0)
            continue
        rms = float(np.sqrt(np.mean(np.square(chunk.astype(np.float64)))))
        curve.append(rms)

    return curve, frame_sec


def _autocorrelation_f0(
    frame: np.ndarray,
    sample_rate: int,
    min_hz: float = 75.0,
    max_hz: float = 500.0,
) -> float:
    """scipy 기반 자기상관(autocorrelation) F0 추정 — parselmouth 미사용 시 폴백.

    프레임 하나에 대해 기본 주파수를 추정한다. 무성/무음 프레임은 0.0을 반환한다.
    """
    frame = frame.astype(np.float64)
    if frame.size < 2:
        return 0.0

    # 무음 프레임은 조기 반환 (자기상관 잡음으로 인한 오탐 방지)
    if np.sqrt(np.mean(np.square(frame))) < 1e-4:
        return 0.0

    frame = frame - np.mean(frame)
    # 자기상관 (FFT 기반, scipy.signal.correlate)
    from scipy.signal import correlate

    corr = correlate(frame, frame, mode="full")
    mid = len(corr) // 2
    corr = corr[mid:]

    min_lag = int(sample_rate / max_hz)
    max_lag = int(sample_rate / min_hz)
    max_lag = min(max_lag, len(corr) - 1)
    if min_lag >= max_lag or max_lag <= 0:
        return 0.0

    segment = corr[min_lag:max_lag]
    if segment.size == 0 or corr[0] <= 0:
        return 0.0

    peak_idx = int(np.argmax(segment))
    peak_val = segment[peak_idx]

    # 정규화된 자기상관 피크가 너무 낮으면 유성음이 아니라고 판단
    normalized = peak_val / corr[0]
    if normalized < 0.3:
        return 0.0

    lag = peak_idx + min_lag
    if lag <= 0:
        return 0.0
    return float(sample_rate) / float(lag)


def f0_track(
    samples: np.ndarray,
    sample_rate: int,
    frame_sec: float = HOP_SEC,
) -> List[F0Point]:
    """F0(기본 주파수) 트랙을 계산한다.

    1차: praat-parselmouth 사용 (정확도 우선).
    2차 폴백: scipy 자기상관 기반 추정 (parselmouth 미설치/실패 시).
    두 경로 모두 동일한 출력 형태 [{t, hz}] 를 보장한다. 무성 구간은 hz=0.
    """
    if samples.size == 0:
        return []

    try:
        return _f0_track_parselmouth(samples, sample_rate, frame_sec)
    except ImportError:
        logger.warning("praat-parselmouth 미설치 — scipy 자기상관 폴백 사용")
        return _f0_track_autocorr(samples, sample_rate, frame_sec)
    except Exception as exc:  # parselmouth 내부 오류(예: 너무 짧은 오디오)도 폴백
        logger.warning("parselmouth F0 추출 실패(%s) — scipy 자기상관 폴백 사용", exc)
        return _f0_track_autocorr(samples, sample_rate, frame_sec)


def _f0_track_parselmouth(
    samples: np.ndarray, sample_rate: int, frame_sec: float
) -> List[F0Point]:
    import parselmouth  # noqa: F401  (미설치 시 여기서 ImportError)

    sound = parselmouth.Sound(samples.astype(np.float64), sampling_frequency=sample_rate)
    pitch = sound.to_pitch(time_step=frame_sec, pitch_floor=75.0, pitch_ceiling=500.0)

    points: List[F0Point] = []
    num_frames = pitch.get_number_of_frames()
    for i in range(1, num_frames + 1):
        t = pitch.get_time_from_frame_number(i)
        hz = pitch.get_value_in_frame(i)
        if hz is None or np.isnan(hz):
            hz = 0.0
        points.append({"t": float(t), "hz": float(hz)})
    return points


def _f0_track_autocorr(
    samples: np.ndarray, sample_rate: int, frame_sec: float
) -> List[F0Point]:
    win = max(1, int(round(0.04 * sample_rate)))  # 40ms 분석 윈도우 (F0 추정엔 넉넉한 길이 필요)
    starts = _frame_starts(samples.size, sample_rate, frame_sec)

    points: List[F0Point] = []
    for s in starts:
        end = min(s + win, samples.size)
        frame = samples[s:end]
        t = float(s) / float(sample_rate)
        hz = _autocorrelation_f0(frame, sample_rate)
        points.append({"t": t, "hz": hz})
    return points


def _voiced_segments_from_f0(f0: List[F0Point], gap_merge_sec: float = 0.1) -> List[VoicedSegment]:
    """F0 트랙에서 hz>0 인 지점들을 연속 구간으로 묶는다."""
    if not f0:
        return []

    segments: List[VoicedSegment] = []
    cur_start: Optional[float] = None
    last_t: Optional[float] = None

    for point in f0:
        voiced = point["hz"] > 0.0
        t = point["t"]
        if voiced:
            if cur_start is None:
                cur_start = t
            last_t = t
        else:
            if cur_start is not None and last_t is not None:
                segments.append(VoicedSegment(start=cur_start, end=last_t))
                cur_start = None
                last_t = None

    if cur_start is not None and last_t is not None:
        segments.append(VoicedSegment(start=cur_start, end=last_t))

    # 짧은 간격으로 끊긴 구간들을 병합 (자연스러운 음절 사이 끊김 보정)
    if not segments:
        return []

    merged: List[VoicedSegment] = [segments[0]]
    for seg in segments[1:]:
        prev = merged[-1]
        if seg.start - prev.end <= gap_merge_sec:
            merged[-1] = VoicedSegment(start=prev.start, end=seg.end)
        else:
            merged.append(seg)

    return merged


def detect_silences(
    samples: np.ndarray,
    sample_rate: int,
    min_duration_sec: float = SILENCE_MIN_DURATION_SEC,
) -> List[TimeRange]:
    """0.8초 이상 지속되는 침묵 구간을 RMS 임계값 기반으로 탐지한다."""
    if samples.size == 0:
        return []

    curve, frame_sec = rms_curve(samples, sample_rate)
    if not curve:
        return []

    curve_arr = np.array(curve, dtype=np.float64)
    overall_rms = float(np.sqrt(np.mean(np.square(samples.astype(np.float64)))))

    if overall_rms < 1e-6:
        # 파일 전체가 무음인 경우 → 전체 구간을 하나의 침묵으로 반환
        duration = samples.size / float(sample_rate)
        if duration >= min_duration_sec:
            return [{"start": 0.0, "end": float(duration)}]
        return []

    threshold = overall_rms * SILENCE_RMS_RATIO
    is_silent = curve_arr < threshold

    silences: List[TimeRange] = []
    cur_start: Optional[int] = None

    for i, silent in enumerate(is_silent):
        if silent:
            if cur_start is None:
                cur_start = i
        else:
            if cur_start is not None:
                start_t = cur_start * frame_sec
                end_t = i * frame_sec
                if end_t - start_t >= min_duration_sec:
                    silences.append({"start": float(start_t), "end": float(end_t)})
                cur_start = None

    if cur_start is not None:
        start_t = cur_start * frame_sec
        end_t = len(curve_arr) * frame_sec
        if end_t - start_t >= min_duration_sec:
            silences.append({"start": float(start_t), "end": float(end_t)})

    return silences


def speech_rate(
    f0: List[F0Point],
    duration_sec: float,
    word_count: Optional[int] = None,
) -> float:
    """발화 속도를 계산한다.

    word_count 가 주어지면 (트랜스크립트 단어 수 있는 경우) '단어 수 / 유성 구간(초)'로 계산한다.
    (design.md: "발화 속도 | 트랜스크립트 단어 수 / 유성 구간")
    word_count 가 없는 경우(오디오 Lambda 단계는 트랜스크립트 이전 실행이라 일반적으로 없음)
    유성 구간의 비율(초당 유성 전환 빈도 근사)로 대체 산출한다 — 흥분도의 근사 지표로 사용.
    """
    if duration_sec <= 0 or not f0:
        return 0.0

    voiced_segments = _voiced_segments_from_f0(f0)
    voiced_duration = sum(seg.end - seg.start for seg in voiced_segments)

    if voiced_duration <= 0:
        return 0.0

    if word_count is not None:
        return float(word_count) / float(voiced_duration)

    # 트랜스크립트가 없는 단계 — 유성 구간 개수(발화 조각 수)를 유성 시간으로 나눠
    # "1초당 발화 전환 빈도"를 흥분도 근사치로 사용한다.
    return float(len(voiced_segments)) / float(voiced_duration)


def laughter_candidates(
    samples: np.ndarray,
    sample_rate: int,
    f0: List[F0Point],
) -> List[TimeRange]:
    """웃음 후보 구간을 탐지한다.

    ⚠️ 웃음 감지는 전용 모델이 아닌 순수 휴리스틱(에너지 진동 + 유성 버스트 패턴)이다.
    오탐/누락이 흔하므로 평점 산출의 근거로 절대 사용하지 않는다.
    서술의 재미 요소와 R8 패턴 탐색 축(hadLaughter)으로만 활용한다 (design.md 참조).

    휴리스틱 정의:
      - RMS 에너지 곡선이 짧은 주기로 여러 번 진동하며(웃음의 "하하하" 같은 반복성)
      - 해당 구간에 유성 버스트(F0 유효 구간)가 존재하고
      - 구간 길이가 0.3~4.0초 범위인 경우를 후보로 채택한다.
    """
    if samples.size == 0 or not f0:
        return []

    curve, frame_sec = rms_curve(samples, sample_rate)
    if len(curve) < 3:
        return []

    curve_arr = np.array(curve, dtype=np.float64)
    overall_rms = float(np.sqrt(np.mean(np.square(samples.astype(np.float64)))))
    if overall_rms < 1e-6:
        return []

    # RMS 곡선의 1차 미분 부호 변화 횟수로 "진동성"을 근사한다.
    diff = np.diff(curve_arr)
    sign_changes = np.where(np.diff(np.sign(diff)) != 0)[0]

    voiced_segments = _voiced_segments_from_f0(f0)
    candidates: List[TimeRange] = []

    for seg in voiced_segments:
        dur = seg.end - seg.start
        if dur < LAUGHTER_MIN_DURATION_SEC or dur > LAUGHTER_MAX_DURATION_SEC:
            continue

        start_frame = int(seg.start / frame_sec)
        end_frame = int(seg.end / frame_sec)
        if end_frame <= start_frame:
            continue

        # 이 유성 구간 내 에너지 진동 횟수 계산
        changes_in_seg = np.sum(
            (sign_changes >= start_frame) & (sign_changes <= end_frame)
        )
        # 구간 길이 대비 진동 빈도가 충분히 높으면 웃음 후보로 채택
        oscillation_rate = changes_in_seg / max(dur, 1e-6)
        if oscillation_rate >= 4.0:  # 초당 4회 이상 진동 (경험적 임계값)
            candidates.append({"start": float(seg.start), "end": float(seg.end)})

    return candidates
