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

# --- 2. 미인증 쓰기 API 검사 -------------------------------------------------
#
# 쓰기 라우트는 두 단계를 통과해야 한다(`lib/auth/guard.ts`).
#   1) Origin 동일 출처 검증 — Origin 이 없거나 다르면 403 (CSRF 방어)
#   2) 편집자 세션 검증 — Origin 이 유효하고 세션이 없으면 401 + loginUrl
# 그래서 Origin 을 붙이지 않으면 401 이 아니라 403 이 온다. 두 경로를 모두 확인한다.
#
# 또한 CloudFront OAC 는 본문을 서명하지 않으므로 본문 해시를 `x-amz-content-sha256` 로
# 실어야 Lambda Function URL 이 요청을 받는다(`lib/http/signedFetch.ts` 와 같은 이유).
# 헤더가 없으면 앱에 도달하기 전에 서명 불일치로 거부된다.
check_unauthenticated_write() {
  local url="$1"
  local response status body payload payload_hash

  payload='{}'
  payload_hash=$(printf '%s' "${payload}" | shasum -a 256 | cut -d' ' -f1)

  response=$(curl --silent --show-error --max-time 15 \
    --output - --write-out $'\n__STATUS__%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -H "Origin: ${BASE_URL}" \
    -H "x-amz-content-sha256: ${payload_hash}" \
    --data "${payload}" \
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

# --- 2b. Origin 없는 쓰기 요청은 403 (CSRF 방어) ----------------------------
# 본문 해시는 붙인다 — 그래야 CloudFront 를 통과해 앱의 Origin 검증까지 도달한다.
check_write_without_origin() {
  local url="$1"
  local status payload payload_hash

  payload='{}'
  payload_hash=$(printf '%s' "${payload}" | shasum -a 256 | cut -d' ' -f1)

  status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -H "x-amz-content-sha256: ${payload_hash}" \
    --data "${payload}" "${url}") || {
    fail "쓰기 API 요청 실패 (연결 오류): ${url}"
    return
  }
  if [[ "${status}" != "403" ]]; then
    fail "Origin 없는 쓰기 요청이 403이 아님 (실제: ${status}): ${url}"
  else
    log "Origin 없는 쓰기 요청 403 확인 (CSRF 방어): ${url}"
  fi
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

check_public_page "${BASE_URL}/"
check_unauthenticated_write "${BASE_URL}/api/tastings"
check_write_without_origin "${BASE_URL}/api/tastings"

# AgentCore Runtime 은 공개 HTTP 엔드포인트가 없다 — 호출에 SigV4 서명이 필요하므로
# curl 로 /ping 을 부를 수 없다. 그래서 URL 이 주어질 때만 검사한다.
if [[ -n "${AGENT_PING_URL}" ]]; then
  log "AGENT_PING_URL=${AGENT_PING_URL}"
  check_agent_ping "${AGENT_PING_URL}"
else
  log "AGENT_PING_URL 미지정 — 에이전트 ping 검사를 건너뜁니다 (AgentCore 는 공개 엔드포인트가 없음)."
fi

if [[ "${FAILED}" -ne 0 ]]; then
  echo "[smoke-test] 하나 이상의 검사가 실패했습니다." >&2
  exit 1
fi

log "모든 스모크 테스트 통과."
