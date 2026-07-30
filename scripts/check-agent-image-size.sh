#!/usr/bin/env bash
#
# 에이전트(agent) 컨테이너 이미지 크기 검사.
# design.md: AgentCore Runtime 이미지 상한 2GB. 상한에 근접하면 CI를 실패시켜
# 배포 전에 조기 차단한다.
#
#   경고 임계값: 1.6GB (2GB 의 80% — 여유 있게 조치할 시점)
#   실패 임계값: 1.9GB (2GB 의 95% — 상한에 근접, 배포 시 실패 위험이 높아 차단)
#
# 사용법:
#   scripts/check-agent-image-size.sh <이미지 참조> [경고바이트] [실패바이트]
#
#   기본값: 경고 1717986918 (1.6*1024^3), 실패 2040109465 (1.9*1024^3)

set -euo pipefail

IMAGE_REF="${1:-}"
WARN_BYTES="${2:-1717986918}"
FAIL_BYTES="${3:-2040109465}"

if [[ -z "${IMAGE_REF}" ]]; then
  echo "오류: 이미지 참조가 필요합니다. 사용법: $0 <이미지 참조> [경고바이트] [실패바이트]" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "오류: docker 명령을 찾을 수 없습니다." >&2
  exit 1
fi

# docker image inspect 로 압축되지 않은 로컬 이미지 크기(바이트)를 조회한다.
# (ECR 상의 압축 크기와는 다를 수 있으나, 실행 시 로드되는 실제 크기 기준으로 검사한다)
SIZE_BYTES="$(docker image inspect "${IMAGE_REF}" --format '{{.Size}}' 2>/dev/null || true)"

if [[ -z "${SIZE_BYTES}" ]]; then
  echo "오류: 이미지를 찾을 수 없습니다: ${IMAGE_REF} (docker pull/build/load 를 먼저 수행하세요)" >&2
  exit 1
fi

SIZE_GB="$(awk -v b="${SIZE_BYTES}" 'BEGIN { printf "%.3f", b / 1024 / 1024 / 1024 }')"
WARN_GB="$(awk -v b="${WARN_BYTES}" 'BEGIN { printf "%.3f", b / 1024 / 1024 / 1024 }')"
FAIL_GB="$(awk -v b="${FAIL_BYTES}" 'BEGIN { printf "%.3f", b / 1024 / 1024 / 1024 }')"

echo "[check-agent-image-size] 이미지: ${IMAGE_REF}"
echo "[check-agent-image-size] 크기: ${SIZE_BYTES} bytes (${SIZE_GB} GB)"
echo "[check-agent-image-size] 경고 임계값: ${WARN_BYTES} bytes (${WARN_GB} GB)"
echo "[check-agent-image-size] 실패 임계값: ${FAIL_BYTES} bytes (${FAIL_GB} GB) — AgentCore 상한 2GB"

if [[ "${SIZE_BYTES}" -ge "${FAIL_BYTES}" ]]; then
  echo "[check-agent-image-size] 실패: 이미지 크기가 실패 임계값(${FAIL_GB} GB) 이상입니다. AgentCore 2GB 상한에 근접하여 배포를 차단합니다." >&2
  exit 1
fi

if [[ "${SIZE_BYTES}" -ge "${WARN_BYTES}" ]]; then
  echo "[check-agent-image-size] 경고: 이미지 크기가 경고 임계값(${WARN_GB} GB) 이상입니다. 의존성을 점검하세요 (배포는 계속 진행)."
fi

echo "[check-agent-image-size] 통과."
