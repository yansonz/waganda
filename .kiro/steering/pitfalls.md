---
inclusion: always
---

# 함정 목록 (한 번 데인 것들)

실제로 시간을 잡아먹었거나 배포를 깨뜨렸을 항목이다. 같은 지점을 건드릴 때 먼저 읽는다.
경위 기록은 `docs/issues/spike-findings.md`.

## 설계 문서와 실제가 다른 부분

- `@strands-agents/sdk` 1.11.2 에 **`GraphBuilder`·`S3SessionManager` 가 없다.**
  파이프라인은 프레임워크 비의존 자체 그래프이고, 모델 호출 노드만 Strands `Agent` 를 쓴다.
  세션은 `SessionManager` + `S3Storage` 조합이다.
- SDK 의 node 엔트리가 `@modelcontextprotocol/sdk` 를 하드 임포트하므로 MCP 를 쓰지 않아도
  agent 의존성에 남겨둬야 한다.
- **Bedrock 의 Claude·Nova·gpt-oss 모두 오디오 입력을 받지 않는다.** Converse API 에
  audio 블록이 있지만 받는 모델이 임베딩 전용뿐이라, 전사는 Amazon Transcribe 로 한다.
  "Claude 에 음성을 바로 넣자"는 방향은 검증 후 폐기됐다.

## 인프라

- DynamoDB 인덱스명은 `GSI1` (대문자). `lib/db/keys.ts` 의 `GSI1_INDEX_NAME` 을 쓴다.
- CDK 스택 간 참조는 **이름 기반 임포트**(`fromBucketName`/`fromRepositoryName`)로 한다.
  객체를 직접 넘기면 `DataStack ↔ WebStack` 순환 의존으로 `cdk synth` 가 깨진다.
  크로스 스택 버킷 정책은 소유 스택에서 계정 범위 조건으로 부여한다.
- CloudFront 오리진에 플레이스홀더 도메인을 남기지 않는다.

## CloudFront + Lambda Function URL (OAC)

- **OAC 는 요청 본문을 서명하지 않는다.** Lambda Function URL 은 unsigned payload 를 거부하므로
  POST·PUT·PATCH 는 클라이언트가 본문 SHA-256 을 `x-amz-content-sha256` 헤더로 보내야 한다.
  없으면 앱에 도달하기도 전에 `The request signature we calculated does not match...` 로 거부된다.
  브라우저 쓰기 요청은 `lib/http/signedFetch.ts` 를 쓴다(`runWriteAction` 이 이미 경유한다).
  **S3 사전 서명 URL 로 직접 올리는 PUT 에는 이 헤더를 붙이지 않는다** — CloudFront 를 거치지 않는다.
- Function URL 은 2025-10 이후 `lambda:InvokeFunctionUrl` **과** `lambda:InvokeFunction` 을 모두
  요구한다. CDK 의 `withOriginAccessControl` 은 앞쪽만 부여하므로 나머지를 직접 추가해야 한다.
- 오리진 요청 정책으로 `ALL_VIEWER_EXCEPT_HOST_HEADER` 를 쓰지 않는다. Authorization 을 전달해
  OAC 서명과 충돌한다. host·authorization 을 제외한 커스텀 정책을 쓴다.
- 컨테이너 Lambda 로 Next.js 를 돌리려면 **Lambda Web Adapter** 가 필요하다. 없으면 서버가
  포트에 뜨기만 하고 런타임 API 에 응답하지 않아 init/invoke 가 타임아웃한다.
- 이미지 태그를 `latest` 로 고정하면 새 이미지를 푸시해도 CloudFormation 이 변경을 감지하지 못해
  Lambda 가 예전 이미지를 계속 쓴다. `WAGANDA_IMAGE_TAG` 를 넘긴다.
- Docker Desktop 이 OCI manifest 로 푸시하면 Lambda 가 이미지를 거부한다.
  `--provenance=false --sbom=false`, `oci-mediatypes=false` 로 푸시한다.

## Next.js

- 미들웨어에서 AWS SDK·`node:crypto` 를 쓰려면 `experimental.nodeMiddleware` 가 필요하다
  (Edge 런타임에서는 불가).
- `distDir` 는 `NODE_ENV` 로 분기한다(dev `.next`, prod `.next-prod`). dev 서버가 도는 중에
  같은 디렉토리로 빌드하면 청크가 섞여 `a[d] is not a function` 이 난다.
- `robots.ts` 같은 메타데이터 라우트는 빌드 시점에 런타임 설정을 요구하면 안 된다.

## S3 / 업로드

- 사전 서명 PUT 에는 `requestChecksumCalculation: 'WHEN_REQUIRED'` 를 준다.
  기본값이면 `x-amz-checksum-crc32` 헤더 때문에 서명 불일치로 거부된다(실제 AWS 에서도).
- 라벨 사진은 반드시 실제로 업로드된 키를 쓴다(`POST /api/labels/upload`).
  가짜 `imageKey` 를 만들어 넘기던 버그가 있었다.
- HEIC 는 브라우저에서 바로 못 읽는다. Safari 는 캔버스, 그 외는 서버 변환
  (`POST /api/labels/convert`, heic-convert)으로 우회한다.

## 인증

- 세션 쿠키는 리다이렉트 응답 객체에 직접 설정해야 실린다.
- `secure` 를 하드코딩하지 않는다. `APP_BASE_URL` 이 http 면 Secure 를 빼야 로컬에서 붙는다.

## 스키마

- 0.5 단위 제약이 걸린 시음 노트 스키마를 평균값에 재사용하면 저장이 항상 실패한다.
  평균은 `TastingNotesAverage` 를 쓴다.

## 시간대

`tastedAt` 은 `toISOString()` 으로 UTC(`Z`)로 저장돼 사용자의 벽시계 시각이 남지 않는다.
그래서 `getHours()`·`getDay()`·`getMonth()` 같은 **로컬 시각 API 를 쓰면 안 된다.**
서버(Lambda)와 CI 는 UTC 로 돌기 때문에 KST 19:30 기록이 `dawn` 으로 집계되고
월초 기록이 이전 달로 밀린다(실제로 CI 를 깨뜨렸다).

요일·시간대·연월 파생은 `lib/domain/types.ts` 의 `SERVICE_TIME_ZONE`(`Asia/Seoul`) 기준
`deriveWeekday` / `deriveHourBucket` / `deriveYearMonth` 를 쓴다. 화면의 `toLocaleString` 계열도
`{ timeZone: SERVICE_TIME_ZONE }` 을 넘긴다. 시각을 다루는 테스트는 기댓값을 **리터럴로** 적어
실행 환경의 TZ 와 무관하게 고정하고, `TZ=UTC npx vitest run` 으로 확인한다.
(예외: `agent/src/lib/budget.ts` 의 일·월 예산 키는 AWS 과금 기준에 맞춰 의도적으로 UTC 다.)

## 화자 분리 실측

Transcribe 화자 분리는 조건부로 동작한다. 두 사람이 충분히 말하면 분리되고, 한쪽이 거의
말하지 않으면 1명으로 판정한다. 실측에서 두 화자의 F0 gap 은 임계값(60Hz)을 크게 웃돌아
신뢰도 high 로 매핑에 성공했다. **임계값을 낮출 근거는 없다.** 1명으로 판정된 경우는
실패가 아니라 경고로 기록하고 매핑을 비운다.
