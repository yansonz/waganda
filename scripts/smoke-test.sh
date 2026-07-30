#!/usr/bin/env bash
#
# 배포 후 스모크 테스트.
# design.md 검증 전략: 공개 페이지 200, 미인증 쓰기 API 401 + loginUrl, 에이전트 /ping 200.
#
# 사용법:
#   BASE_URL=https://waganda-dev.yanbert.com AGENT_PING_URL=https://... scripts/smoke-test.sh
#   또는
#   scripts/smoke-test.sh <BASE_URL> <AGENT_PING_URL>
#
# 실패 시 non-zero exit.

set -euo pipefail

# --- 입력값 확보 (인자 우선, 없으면 환경변수) -------------------------------
BASE_URL="${1:-${BASE_URL:-}}"
AGENT_PING_URL="${2:-${AGENT_PING_URL:-}}"

if [[ -z "${BASE_URL}" ]]; then
  echo "오류: BASE_URL 이 필요합니다 (인자 1번 또는 환경변수)." >&2
  exit 1
fi

if [[ -z "${AGENT_PING_URL}" ]]; then
  echo "오류: AGENT_PING_URL 이 필요합니다 (인자 2번 또는 환경변수)." >&2
  exit 1
fi

# 후행 슬래시 제거 (경로 결합 시 이중 슬래시 방지)
BASE_URL="${BASE_URL%/}"

FAILED=0

log() { printf '[smoke-test] %s\n' "$1"; }
fail() {
  printf '[smoke-test] 실패: %s\n' "$1" >&2
  FAILED=1
}

# --- 1. 공개 페이지 200 응답 확인 ------------------------------------------
check_public_page() {
  local url="$1"
  local status
  # --fail-with-body 는 4xx/5xx 에서 non-zero exit 하므로 상태 코드만 별도로 뜬다
  status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "${url}") || {
    fail "공개 페이지 요청 실패 (연결 오류): ${url}"
    return
  }
  if [[ "${status}" != "200" ]]; then
    fail "공개 페이지 응답이 200이 아님 (실제: ${status}): ${url}"
  else
    log "공개 페이지 200 OK: ${url}"
  fi
}

# --- 2. 미인증 쓰기 API 401 + loginUrl 포함 확인 ---------------------------
check_unauthenticated_write() {
  local url="$1"
  local response status body

  response=$(curl --silent --show-error --max-time 15 \
    --output - --write-out $'\n__STATUS__%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    --data '{}' \
    "${url}") || {
    fail "쓰기 API 요청 실패 (연결 오류): ${url}"
    return
  }

  status="${response##*__STATUS__}"
  body="${response%$'\n__STATUS__'"${status}"}"

  if [[ "${status}" != "401" ]]; then
    fail "쓰기 API가 401이 아님 (실제: ${status}): ${url}"
    return
  fi

  if [[ "${body}" != *"loginUrl"* ]]; then
    fail "401 응답 본문에 loginUrl 이 없음: ${url}"
    return
  fi

  log "미인증 쓰기 API 401 + loginUrl 확인: ${url}"
}

# --- 3. 에이전트 /ping 200 확인 --------------------------------------------
check_agent_ping() {
  local url="$1"
  local status
  status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "${url}") || {
    fail "에이전트 /ping 요청 실패 (연결 오류): ${url}"
    return
  }
  if [[ "${status}" != "200" ]]; then
    fail "에이전트 /ping 응답이 200이 아님 (실제: ${status}): ${url}"
  else
    log "에이전트 /ping 200 OK: ${url}"
  fi
}

log "BASE_URL=${BASE_URL}"
log "AGENT_PING_URL=${AGENT_PING_URL}"

check_public_page "${BASE_URL}/"
check_unauthenticated_write "${BASE_URL}/api/tastings"
check_agent_ping "${AGENT_PING_URL}"

if [[ "${FAILED}" -ne 0 ]]; then
  echo "[smoke-test] 하나 이상의 검사가 실패했습니다." >&2
  exit 1
fi

log "모든 스모크 테스트 통과."
