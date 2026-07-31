"""음향 특징 추출 Lambda 핸들러.

입력: {"bucket": str, "key": str} 또는 {"audioKey": str} (+ 선택적 "bucket")
동작: S3에서 오디오 다운로드 → ffmpeg로 16kHz 모노 WAV 정규화 → features.py 호출
      → Acoustic 스키마(recording.ts) 형태의 dict 반환.

S3 다운로드와 ffmpeg 정규화는 의존성 주입으로 분리되어 있어, 테스트에서는
로컬 WAV 파일을 직접 읽는 대체 구현으로 손쉽게 교체할 수 있다.
"""

from __future__ import annotations

import io
import logging
import os
import subprocess
import tempfile
import wave
from typing import Any, Callable, Dict, Optional, Protocol

import numpy as np

import features

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TARGET_SAMPLE_RATE = 16_000

# ---------------------------------------------------------------------------
# 오류 코드 (예외를 던지지 않고 명시적 코드로 반환한다 — 손상 파일 등에서도
# Lambda 자체가 실패(500)하지 않고 의미 있는 결과를 돌려주기 위함)
# ---------------------------------------------------------------------------
ERROR_DOWNLOAD_FAILED = "DOWNLOAD_FAILED"
ERROR_NORMALIZE_FAILED = "NORMALIZE_FAILED"  # ffmpeg 디코딩 실패 (손상 파일 등)
ERROR_EMPTY_AUDIO = "EMPTY_AUDIO"  # 디코딩 후 샘플이 0개 (초단시간/빈 파일)
ERROR_INVALID_INPUT = "INVALID_INPUT"  # bucket/key 누락 등


class Downloader(Protocol):
    """S3 다운로더 계약. 테스트에서는 로컬 파일 복사로 대체 가능."""

    def __call__(self, bucket: str, key: str, dest_path: str) -> None: ...


class Normalizer(Protocol):
    """오디오 정규화기 계약. 입력 경로 → 16kHz 모노 WAV 경로."""

    def __call__(self, src_path: str, dest_path: str) -> None: ...


def s3_downloader(bucket: str, key: str, dest_path: str) -> None:
    """기본 S3 다운로더. boto3 는 Lambda 런타임에 내장되어 있다."""
    import boto3

    s3 = boto3.client("s3")
    s3.download_file(bucket, key, dest_path)


def ffmpeg_normalizer(src_path: str, dest_path: str) -> None:
    """ffmpeg 로 16kHz 모노 WAV(PCM 16bit)로 정규화한다.

    ffmpeg 실행 파일 경로는 환경변수 FFMPEG_BIN 으로 override 가능
    (Lambda 컨테이너에서는 정적 바이너리 경로를 지정한다).
    """
    ffmpeg_bin = os.environ.get("FFMPEG_BIN", "ffmpeg")
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        src_path,
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-ac",
        "1",
        "-f",
        "wav",
        "-acodec",
        "pcm_s16le",
        dest_path,
    ]
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"ffmpeg 정규화 실패 (exit={result.returncode}): {stderr[:500]}")


def _read_wav_as_float(path: str) -> tuple[np.ndarray, int]:
    """PCM WAV 파일을 -1.0~1.0 범위의 float64 numpy 배열로 읽는다."""
    with wave.open(path, "rb") as wf:
        sample_rate = wf.getframerate()
        n_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sample_width == 2:
        dtype = np.int16
        max_val = 32768.0
    elif sample_width == 1:
        dtype = np.uint8
        max_val = 128.0
    elif sample_width == 4:
        dtype = np.int32
        max_val = 2147483648.0
    else:
        raise ValueError(f"지원하지 않는 WAV 샘플 폭: {sample_width * 8}bit")

    data = np.frombuffer(raw, dtype=dtype).astype(np.float64)
    if sample_width == 1:
        data = data - 128.0  # uint8 PCM 은 128 중심

    if n_channels > 1:
        data = data.reshape(-1, n_channels).mean(axis=1)

    samples = data / max_val
    return samples, sample_rate


def extract_features_from_wav(wav_path: str) -> Dict[str, Any]:
    """정규화된 WAV 파일 경로로부터 Acoustic 스키마 dict 를 계산한다.

    손상되었거나 디코딩할 수 없는 WAV는 ValueError 를 던진다 (호출부에서
    ERROR_NORMALIZE_FAILED 로 변환).
    """
    samples, sample_rate = _read_wav_as_float(wav_path)
    duration_sec = samples.size / float(sample_rate) if sample_rate else 0.0

    if samples.size == 0:
        return {
            "rmsCurve": [],
            "frameSec": features.HOP_SEC,
            "f0Track": [],
            "silences": [],
            "speechRate": 0.0,
            "laughterCandidates": [],
            "durationSec": 0.0,
        }

    rms, frame_sec = features.rms_curve(samples, sample_rate)
    f0 = features.f0_track(samples, sample_rate, frame_sec)
    silences = features.detect_silences(samples, sample_rate)
    rate = features.speech_rate(f0, duration_sec)
    laughter = features.laughter_candidates(samples, sample_rate, f0)

    return {
        "rmsCurve": rms,
        "frameSec": frame_sec,
        "f0Track": f0,
        "silences": silences,
        "speechRate": rate,
        "laughterCandidates": laughter,
        "durationSec": float(duration_sec),
    }


def _parse_input(event: Dict[str, Any]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """이벤트에서 (bucket, key, error_code) 를 추출한다.

    지원 입력 형태:
      {"bucket": "...", "key": "..."}
      {"audioKey": "...", "bucket": "..."}  (bucket 생략 시 환경변수 MEDIA_BUCKET 사용)
    """
    # 인프라(`infrastructure/lib/pipeline-stack.ts`)가 주입하는 이름은 MEDIA_BUCKET_NAME 이다.
    # 예전에는 MEDIA_BUCKET 을 읽어 항상 비어 있었고, 그 결과 오류 dict 를 돌려주어
    # 호출자(에이전트)가 Acoustic 스키마 검증에서 실패했다(rmsCurve 없음).
    bucket = event.get("bucket") or os.environ.get("MEDIA_BUCKET_NAME") or os.environ.get(
        "MEDIA_BUCKET"
    )
    key = event.get("key") or event.get("audioKey")

    if not bucket or not key:
        return None, None, ERROR_INVALID_INPUT

    return bucket, key, None


def process_audio(
    bucket: str,
    key: str,
    downloader: Optional[Downloader] = None,
    normalizer: Optional[Normalizer] = None,
) -> Dict[str, Any]:
    """다운로드 → 정규화 → 특징 추출 전체 흐름. 예외 없이 결과 또는 오류 코드를 반환한다.

    downloader/normalizer 를 생략하면 모듈 기본 구현(s3_downloader/ffmpeg_normalizer)을
    호출 시점에 조회한다 — 테스트에서 `monkeypatch.setattr(handler, "s3_downloader", ...)`
    로 모듈 속성을 교체해도 반영되도록 지연 바인딩한다 (default 인자 바인딩 시점 문제 회피).
    """
    if downloader is None:
        downloader = s3_downloader
    if normalizer is None:
        normalizer = ffmpeg_normalizer

    with tempfile.TemporaryDirectory() as tmp_dir:
        src_path = os.path.join(tmp_dir, "input.audio")
        wav_path = os.path.join(tmp_dir, "normalized.wav")

        try:
            downloader(bucket, key, src_path)
        except Exception as exc:
            logger.error("S3 다운로드 실패: %s", exc)
            return {"error": ERROR_DOWNLOAD_FAILED, "message": str(exc)}

        try:
            normalizer(src_path, wav_path)
        except Exception as exc:
            logger.error("오디오 정규화 실패(손상 파일 가능성): %s", exc)
            return {"error": ERROR_NORMALIZE_FAILED, "message": str(exc)}

        try:
            result = extract_features_from_wav(wav_path)
        except Exception as exc:
            logger.error("특징 추출 실패: %s", exc)
            return {"error": ERROR_NORMALIZE_FAILED, "message": str(exc)}

        if result["durationSec"] <= 0.0:
            logger.warning("빈 오디오 — durationSec=0")
            result["error"] = None  # 빈 오디오는 오류가 아니라 의미 있는 결과(전부 0/빈 배열)로 취급

        return result


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda 엔트리포인트.

    성공 시 Acoustic 스키마와 일치하는 dict 를 반환한다.
    실패 시 {"error": <코드>, "message": <설명>} 를 반환한다 (예외를 던지지 않음 —
    파이프라인 오케스트레이터가 이 신호로 재시도/격리 여부를 판단한다).
    """
    logger.info("이벤트 수신: %s", {k: v for k, v in event.items() if k != "context"})

    bucket, key, err = _parse_input(event)
    if err:
        return {"error": err, "message": "bucket/key 또는 audioKey 가 필요합니다."}

    return process_audio(bucket, key)
