"""handler.py 단위 테스트.

S3 다운로드와 ffmpeg 정규화는 의존성 주입으로 대체하여, 실제 S3/ffmpeg 없이
로컬 WAV 파일 기반으로 전체 흐름을 검증한다. 손상 파일·무음 파일·초단시간
파일에서 예외 없이 의미 있는 결과 또는 명시적 오류 코드가 반환되는지 확인한다.

또한 handler 가 반환하는 dict 가 `packages/schemas/src/recording.ts` 의
Acoustic 스키마 필드 구조와 일치하는지, 파이썬 측 하드코딩 기대 스펙과
스키마 파일을 직접 파싱한 필드 목록 양쪽으로 검증한다.
"""

from __future__ import annotations

import re
import struct
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import handler  # noqa: E402

SAMPLE_RATE = 16_000
REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "packages" / "schemas" / "src" / "recording.ts"

# Acoustic 스키마(recording.ts)와 대응하는 파이썬 측 기대 필드·타입 스펙.
# 스키마가 바뀌면 이 상수와 스키마 파일 파싱 결과 양쪽이 실패해야 발견 가능하다.
EXPECTED_ACOUSTIC_FIELDS = {
    "rmsCurve": list,
    "frameSec": float,
    "f0Track": list,       # 원소: {"t": float, "hz": float}
    "silences": list,      # 원소: {"start": float, "end": float}
    "speechRate": float,
    "laughterCandidates": list,  # 원소: {"start": float, "end": float}
    "durationSec": float,
}


def write_wav(path: Path, samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    """float64(-1~1) numpy 배열을 16bit PCM WAV로 저장한다."""
    clipped = np.clip(samples, -1.0, 1.0)
    int_samples = (clipped * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int_samples.tobytes())


def make_sine_wav(path: Path, freq_hz: float = 220.0, duration_sec: float = 1.5) -> None:
    t = np.linspace(0, duration_sec, int(SAMPLE_RATE * duration_sec), endpoint=False)
    samples = 0.5 * np.sin(2 * np.pi * freq_hz * t)
    write_wav(path, samples)


def make_silence_wav(path: Path, duration_sec: float = 1.5) -> None:
    samples = np.zeros(int(SAMPLE_RATE * duration_sec), dtype=np.float64)
    write_wav(path, samples)


def make_tiny_wav(path: Path, duration_sec: float = 0.05) -> None:
    """0.05초 초단시간 파일."""
    make_sine_wav(path, freq_hz=300.0, duration_sec=duration_sec)


def make_corrupt_file(path: Path) -> None:
    """랜덤 바이트로 채워진 손상 파일 (WAV 헤더가 아님)."""
    rng = np.random.default_rng(7)
    path.write_bytes(rng.integers(0, 256, size=2048, dtype=np.uint8).tobytes())


def local_copy_downloader(src_path: Path):
    """테스트용 S3 다운로더 대체 — 실제로는 로컬 파일을 복사한다."""

    def _download(bucket: str, key: str, dest_path: str) -> None:
        Path(dest_path).write_bytes(Path(src_path).read_bytes())

    return _download


def passthrough_normalizer(src_path: str, dest_path: str) -> None:
    """정규화 단계를 모킹 — 이미 16kHz 모노 WAV인 테스트 입력을 그대로 복사한다.
    (로컬 환경에 ffmpeg 필수 의존을 두지 않기 위한 우회)"""
    Path(dest_path).write_bytes(Path(src_path).read_bytes())


def failing_normalizer(src_path: str, dest_path: str) -> None:
    """손상 파일 시나리오 검증용 — ffmpeg 디코딩 실패를 흉내낸다."""
    raise RuntimeError("ffmpeg 정규화 실패: invalid data found when processing input")


class TestProcessAudioWithMockedIO:
    def test_sine_wave_produces_valid_acoustic_dict(self, tmp_path):
        wav_path = tmp_path / "sine.wav"
        make_sine_wav(wav_path)

        result = handler.process_audio(
            bucket="test-bucket",
            key="test-key.wav",
            downloader=local_copy_downloader(wav_path),
            normalizer=passthrough_normalizer,
        )

        assert "error" not in result or result.get("error") is None
        assert result["durationSec"] > 1.0
        assert len(result["rmsCurve"]) > 0
        assert len(result["f0Track"]) > 0

    def test_silence_file_returns_meaningful_result_not_exception(self, tmp_path):
        wav_path = tmp_path / "silence.wav"
        make_silence_wav(wav_path)

        result = handler.process_audio(
            bucket="test-bucket",
            key="silence.wav",
            downloader=local_copy_downloader(wav_path),
            normalizer=passthrough_normalizer,
        )

        assert result.get("error") in (None,)
        assert result["durationSec"] > 1.0
        # 무음이므로 침묵 구간이 검출되거나 최소한 f0Track 전부 0이어야 함
        assert all(p["hz"] == 0.0 for p in result["f0Track"])
        assert result["speechRate"] == 0.0

    def test_tiny_file_does_not_raise(self, tmp_path):
        wav_path = tmp_path / "tiny.wav"
        make_tiny_wav(wav_path)

        result = handler.process_audio(
            bucket="test-bucket",
            key="tiny.wav",
            downloader=local_copy_downloader(wav_path),
            normalizer=passthrough_normalizer,
        )

        # 예외 없이 dict 반환. 0.05초는 durationSec>0 이거나, 프레임 미달로 0일 수 있음 — 둘 다 허용.
        assert isinstance(result, dict)
        assert "durationSec" in result
        assert result["durationSec"] >= 0.0

    def test_corrupt_file_returns_explicit_error_code(self, tmp_path):
        corrupt_path = tmp_path / "corrupt.bin"
        make_corrupt_file(corrupt_path)

        result = handler.process_audio(
            bucket="test-bucket",
            key="corrupt.bin",
            downloader=local_copy_downloader(corrupt_path),
            normalizer=failing_normalizer,
        )

        assert result.get("error") == handler.ERROR_NORMALIZE_FAILED
        assert "message" in result

    def test_download_failure_returns_explicit_error_code(self, tmp_path):
        def broken_downloader(bucket, key, dest_path):
            raise ConnectionError("S3 접근 실패 (시뮬레이션)")

        result = handler.process_audio(
            bucket="test-bucket",
            key="whatever.wav",
            downloader=broken_downloader,
            normalizer=passthrough_normalizer,
        )

        assert result.get("error") == handler.ERROR_DOWNLOAD_FAILED

    def test_empty_wav_file_handled_gracefully(self, tmp_path):
        """0 프레임짜리 WAV — 초단시간의 극단적 경우."""
        wav_path = tmp_path / "empty.wav"
        write_wav(wav_path, np.array([], dtype=np.float64))

        result = handler.process_audio(
            bucket="test-bucket",
            key="empty.wav",
            downloader=local_copy_downloader(wav_path),
            normalizer=passthrough_normalizer,
        )

        assert isinstance(result, dict)
        assert result["durationSec"] == 0.0
        assert result["rmsCurve"] == []
        assert result["f0Track"] == []


class TestLambdaHandlerInputParsing:
    def test_missing_bucket_and_key_returns_invalid_input_error(self):
        result = handler.lambda_handler({}, None)
        assert result["error"] == handler.ERROR_INVALID_INPUT

    def test_audio_key_input_form_accepted(self, tmp_path, monkeypatch):
        wav_path = tmp_path / "sine.wav"
        make_sine_wav(wav_path, duration_sec=1.0)

        monkeypatch.setattr(handler, "s3_downloader", local_copy_downloader(wav_path))
        monkeypatch.setattr(handler, "ffmpeg_normalizer", passthrough_normalizer)

        event = {"bucket": "test-bucket", "audioKey": "recordings/1.wav"}
        result = handler.lambda_handler(event, None)

        assert result.get("error") is None
        assert result["durationSec"] > 0


class TestAcousticSchemaConformance:
    """handler 출력이 Acoustic 스키마(recording.ts)와 정확히 일치하는지 검증한다."""

    @pytest.fixture()
    def sample_result(self, tmp_path):
        wav_path = tmp_path / "sine.wav"
        make_sine_wav(wav_path, duration_sec=1.2)
        return handler.process_audio(
            bucket="test-bucket",
            key="sine.wav",
            downloader=local_copy_downloader(wav_path),
            normalizer=passthrough_normalizer,
        )

    def test_field_names_match_hardcoded_expected_spec(self, sample_result):
        result_keys = set(sample_result.keys()) - {"error"}
        assert result_keys == set(EXPECTED_ACOUSTIC_FIELDS.keys())

    def test_field_types_match_hardcoded_expected_spec(self, sample_result):
        for field, expected_type in EXPECTED_ACOUSTIC_FIELDS.items():
            value = sample_result[field]
            if expected_type is float:
                assert isinstance(value, (int, float)), f"{field} 타입 불일치: {type(value)}"
            else:
                assert isinstance(value, expected_type), f"{field} 타입 불일치: {type(value)}"

    def test_f0_track_points_have_t_and_hz(self, sample_result):
        for point in sample_result["f0Track"]:
            assert set(point.keys()) == {"t", "hz"}

    def test_silences_have_start_and_end(self, sample_result):
        for s in sample_result["silences"]:
            assert set(s.keys()) == {"start", "end"}

    def test_laughter_candidates_have_start_and_end(self, sample_result):
        for c in sample_result["laughterCandidates"]:
            assert set(c.keys()) == {"start", "end"}

    def test_schema_file_field_list_matches_python_output(self, sample_result):
        """recording.ts 를 직접 파싱해 Acoustic 스키마의 필드 목록을 추출하고,
        파이썬 핸들러 출력 필드와 정확히 일치하는지 비교한다.

        스키마 파일이 변경되었는데 파이썬 쪽이 갱신되지 않으면 이 테스트가 실패해야 한다.
        """
        assert SCHEMA_PATH.exists(), f"스키마 파일을 찾을 수 없음: {SCHEMA_PATH}"
        content = SCHEMA_PATH.read_text(encoding="utf-8")

        # `export const Acoustic = z.object({ ... });` 블록만 추출
        match = re.search(r"export const Acoustic = z\.object\(\{(.*?)\}\);", content, re.DOTALL)
        assert match, "recording.ts 에서 Acoustic 스키마 블록을 찾지 못함"
        block = match.group(1)

        # 필드명 추출: 줄 시작(공백 포함) 후 `필드명:` 형태. 주석(/** ... */) 라인은 제외.
        field_names = re.findall(r"^\s*([a-zA-Z][a-zA-Z0-9]*):\s", block, re.MULTILINE)

        assert set(field_names) == set(EXPECTED_ACOUSTIC_FIELDS.keys()), (
            f"recording.ts 의 Acoustic 필드({sorted(field_names)})와 "
            f"파이썬 기대 스펙({sorted(EXPECTED_ACOUSTIC_FIELDS.keys())})이 다름"
        )

        # 핸들러 실제 출력도 동일 필드 집합을 가져야 함
        result_keys = set(sample_result.keys()) - {"error"}
        assert result_keys == set(field_names)
