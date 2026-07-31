#!/bin/bash
#
# SSM Parameter Store에 SecureString 파라미터를 생성한다 (멱등성 보장).
# CDK는 SecureString을 생성할 수 없으므로 이 스크립트로 사전에 생성해야 한다.
#
# 사용법:
#   ./scripts/put-secrets.sh --env prod \
#     --google-client-id "..." \
#     --google-client-secret "..." \
#     --jwt-secret "..." \
#     --editor-allowlist "user1@example.com,user2@example.com" \
#     --serpapi-key "..."
#
# 옵션:
#   --env ENV                       prod (필수) — 이 프로젝트는 prod 만 배포한다
#   --google-client-id VALUE        Google OAuth Client ID
#   --google-client-secret VALUE    Google OAuth Client Secret
#   --jwt-secret VALUE              JWT 서명 키 (HS256)
#   --editor-allowlist VALUE        쉼표 구분 편집자 이메일
#   --serpapi-key VALUE             SerpAPI 키 (선택 — 없으면 라벨 보강이 검색 없이 동작)
#   --overwrite                     기존 파라미터 덮어쓰기 (기본: 존재하면 스킵)
#   --region REGION                 AWS 리전 (기본: ap-northeast-2)
#
# 프로필은 `waganda` 로 고정한다 — 이 프로젝트의 AWS 리소스는 그 계정에만 존재한다.
# 다른 계정에 시크릿을 넣으면 배포된 Lambda·AgentCore 가 읽지 못하고 증상은 인증 실패로만
# 드러난다(실제로 다른 계정에 등록돼 있어 로그인이 되지 않았다).

set -euo pipefail

# 기본값
ENV=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
JWT_SECRET=""
EDITOR_ALLOWLIST=""
SERPAPI_KEY=""
OVERWRITE=false
# 이 프로젝트는 waganda 프로필(단일 계정)만 사용한다. 예외를 두지 않는다.
REQUIRED_PROFILE="waganda"
REGION="ap-northeast-2"

# 옵션 파싱
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --google-client-id) GOOGLE_CLIENT_ID="$2"; shift 2 ;;
    --google-client-secret) GOOGLE_CLIENT_SECRET="$2"; shift 2 ;;
    --jwt-secret) JWT_SECRET="$2"; shift 2 ;;
    --editor-allowlist) EDITOR_ALLOWLIST="$2"; shift 2 ;;
    --serpapi-key) SERPAPI_KEY="$2"; shift 2 ;;
    --overwrite) OVERWRITE=true; shift ;;
    --region) REGION="$2"; shift 2 ;;
    *)
      echo "ERROR: 알 수 없는 옵션: $1"
      exit 1
      ;;
  esac
done

# 필수 옵션 검증
if [[ -z "$ENV" ]]; then
  echo "ERROR: --env 이 필수입니다 (prod)"
  exit 1
fi

if [[ "$ENV" != "prod" ]]; then
  echo "ERROR: --env 은 'prod' 여야 합니다 (dev 환경은 없다)"
  exit 1
fi

# AWS CLI 옵션 구성
# 프로필을 명시해 셸 환경(AWS_PROFILE)과 무관하게 항상 같은 계정을 대상으로 한다.
AWS_OPTS=("--region" "$REGION" "--profile" "$REQUIRED_PROFILE")

# 대상 계정·리전을 확인한다.
# 시크릿을 다른 계정에 넣으면 배포된 Lambda·AgentCore 가 읽지 못하고, 증상은 인증 실패로만 나타난다.
if ! CURRENT_ACCOUNT=$(aws sts get-caller-identity "${AWS_OPTS[@]}" --query Account --output text 2>/dev/null); then
  echo "ERROR: '$REQUIRED_PROFILE' 프로필로 자격증명을 확인할 수 없습니다."
  echo "       aws sso login --profile $REQUIRED_PROFILE 후 다시 실행하세요."
  exit 1
fi
echo "대상: 프로필=$REQUIRED_PROFILE 계정=$CURRENT_ACCOUNT 리전=$REGION 환경=$ENV"

# 파라미터 생성 헬퍼 함수 (멱등성: 이미 존재하면 --overwrite 옵션으로만 업데이트)
put_parameter() {
  local name="$1"
  local value="$2"
  local exists=false

  # 파라미터 존재 여부 확인
  if aws ssm get-parameter "${AWS_OPTS[@]}" --name "$name" >/dev/null 2>&1; then
    exists=true
  fi

  if [[ "$exists" == true && "$OVERWRITE" == false ]]; then
    echo "SKIP: $name (이미 존재, --overwrite 필요)"
    return 0
  fi

  # --overwrite 옵션 구성
  local put_opts=("${AWS_OPTS[@]}" --type SecureString --name "$name" --value "$value")
  if [[ "$OVERWRITE" == true ]]; then
    put_opts+=(--overwrite)
  fi

  aws ssm put-parameter "${put_opts[@]}" >/dev/null
  echo "OK: $name"
}

# 파라미터 생성 (값이 비어있지 않을 때만)
if [[ -n "$GOOGLE_CLIENT_ID" ]]; then
  put_parameter "/waganda/$ENV/google/client-id" "$GOOGLE_CLIENT_ID"
fi

if [[ -n "$GOOGLE_CLIENT_SECRET" ]]; then
  put_parameter "/waganda/$ENV/google/client-secret" "$GOOGLE_CLIENT_SECRET"
fi

if [[ -n "$JWT_SECRET" ]]; then
  put_parameter "/waganda/$ENV/auth/jwt-secret" "$JWT_SECRET"
fi

if [[ -n "$EDITOR_ALLOWLIST" ]]; then
  put_parameter "/waganda/$ENV/auth/editor-allowlist" "$EDITOR_ALLOWLIST"
fi

# 라벨 보강용 웹 검색 키 — 선택 항목이다.
# 없으면 lib/search/serpapi.ts 가 프로바이더를 만들지 않고, 보강은 모델 지식만으로 진행한다.
if [[ -n "$SERPAPI_KEY" ]]; then
  put_parameter "/waganda/$ENV/search/serpapi-key" "$SERPAPI_KEY"
fi

echo ""
echo "완료: SSM 파라미터 생성/업데이트 완료 (환경: $ENV, 리전: $REGION)"
