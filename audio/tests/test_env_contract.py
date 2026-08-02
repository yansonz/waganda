"""환경변수 계약 테스트.

인프라(`infrastructure/lib/pipeline-stack.ts`)가 주입하는 이름과 핸들러가 읽는 이름이
일치해야 한다. 어긋나면 버킷을 못 찾아 오류 dict 를 돌려주고, 호출자(에이전트)는 그것을
Acoustic 스키마로 파싱하려다 실패한다 — 실제로 `MEDIA_BUCKET` 을 읽어 이 문제가 있었다
(`rmsCurve` 필드가 없다는 검증 오류로만 드러났다).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# test_handler.py / test_features.py 와 동일한 방어 코드.
# pytest 의 수집 순서(알파벳순: test_env_contract.py 가 가장 먼저)에서는 다른 테스트
# 파일이 sys.path 에 audio/ 를 추가하기 전에 이 파일이 import 되므로, 각자 독립적으로
# 경로를 추가해야 한다. 누락되면 `ModuleNotFoundError: No module named 'handler'` 로
# 컬렉션 자체가 실패해 37개 테스트 전체가 실행되지 않는다(CI 재현됨).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import handler  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_STACK = REPO_ROOT / "infrastructure" / "lib" / "pipeline-stack.ts"


def _injected_audio_env_names() -> set[str]:
    """오디오 Lambda 정의에서 주입되는 환경변수 이름을 뽑는다."""
    source = PIPELINE_STACK.read_text(encoding="utf-8")

    # AudioProcessorLambda 블록만 본다(다른 Lambda 의 환경변수와 섞이지 않게).
    start = source.index("AudioProcessorLambda")
    end = source.index("AgentCore 실행 Role", start)
    block = source[start:end]

    return set(re.findall(r"^\s*([A-Z][A-Z0-9_]*):", block, re.MULTILINE))


def test_핸들러가_읽는_버킷_환경변수가_인프라_주입_이름과_일치한다() -> None:
    injected = _injected_audio_env_names()
    assert "MEDIA_BUCKET_NAME" in injected, (
        f"인프라가 주입하는 이름이 바뀌었다: {sorted(injected)}"
    )

    handler_source = Path(handler.__file__).read_text(encoding="utf-8")
    assert "MEDIA_BUCKET_NAME" in handler_source, (
        "핸들러가 인프라 주입 이름을 읽지 않는다 — 버킷을 찾지 못해 분석이 멈춘다"
    )


def test_버킷_환경변수가_있으면_이벤트에_bucket_없이도_동작한다(monkeypatch) -> None:
    monkeypatch.setenv("MEDIA_BUCKET_NAME", "waganda-media-test")
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)

    bucket, key, err = handler._parse_input({"audioKey": "recordings/t1/r1.webm"})

    assert err is None, f"파싱이 실패했다: {err}"
    assert bucket == "waganda-media-test"
    assert key == "recordings/t1/r1.webm"


def test_버킷을_알_수_없으면_오류를_돌려준다(monkeypatch) -> None:
    monkeypatch.delenv("MEDIA_BUCKET_NAME", raising=False)
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)

    _bucket, _key, err = handler._parse_input({"audioKey": "recordings/t1/r1.webm"})

    assert err is not None
