"""features.py 단위 테스트.

numpy로 합성한 사인파(유성음 근사)·무음·백색소음을 사용해
각 특징 추출 함수를 결정론적으로 검증한다. 실제 음성 대신
사인파를 쓰는 이유는 F0 를 정확히 알고 있는 신호로 추정 정확도를
검증할 수 있기 때문이다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import features  # noqa: E402

SAMPLE_RATE = 16_000


def make_sine(freq_hz: float, duration_sec: float, sample_rate: int = SAMPLE_RATE, amplitude: float = 0.5) -> np.ndarray:
    """단일 주파수 사인파 생성 (유성음 근사)."""
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    return (amplitude * np.sin(2 * np.pi * freq_hz * t)).astype(np.float64)


def make_silence(duration_sec: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    return np.zeros(int(sample_rate * duration_sec), dtype=np.float64)


def make_white_noise(duration_sec: float, sample_rate: int = SAMPLE_RATE, amplitude: float = 0.3, seed: int = 42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (amplitude * rng.standard_normal(int(sample_rate * duration_sec))).astype(np.float64)


def make_laughter_like(duration_sec: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """웃음과 유사한 진동성 에너지 패턴 합성 — 200Hz 사인파를 8Hz 로 진폭 변조."""
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    carrier = np.sin(2 * np.pi * 200 * t)
    envelope = 0.5 * (1 + np.sin(2 * np.pi * 8 * t))  # 0~1 사이 8Hz 진동 (하-하-하 패턴 근사)
    return (0.6 * envelope * carrier).astype(np.float64)


class TestRmsCurve:
    def test_sine_wave_has_nonzero_rms(self):
        samples = make_sine(220, 1.0)
        curve, frame_sec = features.rms_curve(samples, SAMPLE_RATE)
        assert frame_sec == features.HOP_SEC
        assert len(curve) > 0
        assert all(v > 0 for v in curve)

    def test_silence_has_near_zero_rms(self):
        samples = make_silence(1.0)
        curve, _ = features.rms_curve(samples, SAMPLE_RATE)
        assert len(curve) > 0
        assert all(v == 0.0 for v in curve)

    def test_empty_input_returns_empty_curve(self):
        samples = np.array([], dtype=np.float64)
        curve, frame_sec = features.rms_curve(samples, SAMPLE_RATE)
        assert curve == []
        assert frame_sec == features.HOP_SEC

    def test_louder_signal_has_higher_rms(self):
        quiet = make_sine(220, 1.0, amplitude=0.1)
        loud = make_sine(220, 1.0, amplitude=0.8)
        quiet_curve, _ = features.rms_curve(quiet, SAMPLE_RATE)
        loud_curve, _ = features.rms_curve(loud, SAMPLE_RATE)
        assert np.mean(loud_curve) > np.mean(quiet_curve)


class TestF0Track:
    def test_sine_wave_f0_close_to_true_frequency(self):
        """220Hz 사인파의 F0 추정치가 실제 주파수에 근접해야 한다."""
        samples = make_sine(220, 1.0)
        track = features.f0_track(samples, SAMPLE_RATE)
        assert len(track) > 0

        voiced_hz = [p["hz"] for p in track if p["hz"] > 0]
        assert len(voiced_hz) > 0, "220Hz 사인파에서 유성 프레임이 하나도 검출되지 않음"
        mean_hz = np.mean(voiced_hz)
        # parselmouth/자기상관 모두 몇 Hz 오차는 정상 — 15% 이내 근접 허용
        assert abs(mean_hz - 220) / 220 < 0.15, f"추정 F0={mean_hz}, 기대값=220"

    def test_silence_has_zero_f0(self):
        samples = make_silence(1.0)
        track = features.f0_track(samples, SAMPLE_RATE)
        assert len(track) > 0
        assert all(p["hz"] == 0.0 for p in track)

    def test_output_shape_has_t_and_hz_keys(self):
        samples = make_sine(150, 0.5)
        track = features.f0_track(samples, SAMPLE_RATE)
        for point in track:
            assert set(point.keys()) == {"t", "hz"}
            assert isinstance(point["t"], float)
            assert isinstance(point["hz"], float)

    def test_empty_input_returns_empty_track(self):
        samples = np.array([], dtype=np.float64)
        assert features.f0_track(samples, SAMPLE_RATE) == []

    def test_autocorrelation_fallback_matches_shape(self):
        """parselmouth 없이 폴백 경로만 직접 호출해도 동일 출력 형태를 지키는지 확인."""
        samples = make_sine(220, 1.0)
        track = features._f0_track_autocorr(samples, SAMPLE_RATE, features.HOP_SEC)
        assert len(track) > 0
        for point in track:
            assert set(point.keys()) == {"t", "hz"}
        voiced_hz = [p["hz"] for p in track if p["hz"] > 0]
        assert len(voiced_hz) > 0
        assert abs(np.mean(voiced_hz) - 220) / 220 < 0.15


class TestDetectSilences:
    def test_detects_long_silence_gap(self):
        """발화-침묵(1.2초)-발화 패턴에서 중간 침묵 구간을 검출해야 한다."""
        speech1 = make_sine(220, 1.0, amplitude=0.6)
        gap = make_silence(1.2)
        speech2 = make_sine(220, 1.0, amplitude=0.6)
        samples = np.concatenate([speech1, gap, speech2])

        silences = features.detect_silences(samples, SAMPLE_RATE)
        assert len(silences) >= 1
        # 침묵 구간이 대략 1.0~1.2초 부근에서 시작해야 함
        found = any(0.9 <= s["start"] <= 1.3 for s in silences)
        assert found, f"예상 위치의 침묵 미검출: {silences}"

    def test_short_gap_below_threshold_not_detected(self):
        """0.8초 미만의 짧은 침묵은 검출되지 않아야 한다."""
        speech1 = make_sine(220, 0.5, amplitude=0.6)
        short_gap = make_silence(0.3)
        speech2 = make_sine(220, 0.5, amplitude=0.6)
        samples = np.concatenate([speech1, short_gap, speech2])

        silences = features.detect_silences(samples, SAMPLE_RATE)
        # 0.3초짜리 침묵은 min_duration(0.8초) 미달이므로 결과에 남아 있으면 안 됨
        for s in silences:
            assert (s["end"] - s["start"]) >= 0.8 - 1e-6

    def test_full_silence_file_returns_whole_range(self):
        samples = make_silence(2.0)
        silences = features.detect_silences(samples, SAMPLE_RATE)
        assert len(silences) == 1
        assert silences[0]["start"] == 0.0
        assert silences[0]["end"] == pytest.approx(2.0, abs=0.05)

    def test_empty_input_returns_empty_list(self):
        samples = np.array([], dtype=np.float64)
        assert features.detect_silences(samples, SAMPLE_RATE) == []

    def test_all_silences_meet_min_duration(self):
        speech = make_sine(220, 0.5, amplitude=0.6)
        gap = make_silence(1.5)
        samples = np.concatenate([speech, gap, speech])
        silences = features.detect_silences(samples, SAMPLE_RATE)
        for s in silences:
            assert (s["end"] - s["start"]) >= 0.8


class TestSpeechRate:
    def test_zero_duration_returns_zero(self):
        assert features.speech_rate([], 0.0) == 0.0

    def test_empty_f0_returns_zero(self):
        assert features.speech_rate([], 5.0) == 0.0

    def test_with_word_count_uses_words_per_voiced_second(self):
        samples = make_sine(220, 2.0)
        f0 = features.f0_track(samples, SAMPLE_RATE)
        rate = features.speech_rate(f0, 2.0, word_count=10)
        assert rate > 0

    def test_without_word_count_returns_positive_for_voiced_audio(self):
        samples = make_sine(220, 2.0)
        f0 = features.f0_track(samples, SAMPLE_RATE)
        rate = features.speech_rate(f0, 2.0)
        assert rate > 0

    def test_silence_returns_zero_rate(self):
        samples = make_silence(2.0)
        f0 = features.f0_track(samples, SAMPLE_RATE)
        rate = features.speech_rate(f0, 2.0)
        assert rate == 0.0


class TestLaughterCandidates:
    """웃음 감지는 휴리스틱이며 평점 근거로 쓰지 않는다 (design.md 명시).
    여기서는 "명백히 진동성인 신호에서 후보가 나오는지" 정도만 검증한다."""

    def test_returns_list_of_time_ranges(self):
        samples = make_laughter_like(1.5)
        f0 = features.f0_track(samples, SAMPLE_RATE)
        candidates = features.laughter_candidates(samples, SAMPLE_RATE, f0)
        assert isinstance(candidates, list)
        for c in candidates:
            assert set(c.keys()) == {"start", "end"}
            assert c["end"] > c["start"]

    def test_silence_yields_no_candidates(self):
        samples = make_silence(2.0)
        f0 = features.f0_track(samples, SAMPLE_RATE)
        candidates = features.laughter_candidates(samples, SAMPLE_RATE, f0)
        assert candidates == []

    def test_steady_sine_yields_no_or_few_candidates(self):
        """일정한(진동 없는) 사인파는 웃음 패턴과 달라야 한다."""
        samples = make_sine(220, 2.0, amplitude=0.6)
        f0 = features.f0_track(samples, SAMPLE_RATE)
        candidates = features.laughter_candidates(samples, SAMPLE_RATE, f0)
        # 완전히 0이 아닐 수는 있으나(경계 근처), 웃음형 신호보다 훨씬 적어야 함
        laughter_samples = make_laughter_like(2.0)
        laughter_f0 = features.f0_track(laughter_samples, SAMPLE_RATE)
        laughter_candidates = features.laughter_candidates(laughter_samples, SAMPLE_RATE, laughter_f0)
        assert len(laughter_candidates) >= len(candidates)

    def test_empty_input_returns_empty_list(self):
        samples = np.array([], dtype=np.float64)
        assert features.laughter_candidates(samples, SAMPLE_RATE, []) == []
