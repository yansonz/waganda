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
- **공개 페이지 캐시 키에 `RSC` 헤더와 쿼리 문자열을 반드시 포함한다.** App Router 의 클라이언트
  라우팅은 같은 경로에 `RSC: 1` 헤더와 `?_rsc=` 쿼리를 붙여 RSC payload(`text/x-component`)를
  요청한다. 캐시 키가 이를 구분하지 않으면 캐시된 HTML 이 RSC 요청에 반환되어 **탭 이동 시
  빈 화면**이 된다. 캐시가 살아있는 동안 뒤로가기도 같은 응답을 받고 새로고침만 정상 동작한다.
  진단은 `curl -H 'RSC: 1' <url>` 로 content-type 을 보면 된다.
- 컨테이너 Lambda 로 Next.js 를 돌리려면 **Lambda Web Adapter** 가 필요하다. 없으면 서버가
  포트에 뜨기만 하고 런타임 API 에 응답하지 않아 init/invoke 가 타임아웃한다.
- 이미지 태그를 `latest` 로 고정하면 새 이미지를 푸시해도 CloudFormation 이 변경을 감지하지 못해
  Lambda 가 예전 이미지를 계속 쓴다. `WAGANDA_IMAGE_TAG` 를 넘긴다.
- Docker Desktop 이 OCI manifest 로 푸시하면 Lambda 가 이미지를 거부한다.
  `--provenance=false --sbom=false`, `oci-mediatypes=false` 로 푸시한다.

## GitHub Actions 배포 (OIDC + ARM64)

- **OIDC 신뢰 정책의 `sub` 는 두 형태를 모두 허용해야 한다.** GitHub 은 불변 ID 형식
  (`repo:<owner>@<ownerId>/<repo>@<repoId>`)으로 발급하고, 잡에 `environment:` 가 지정되면
  `ref:refs/heads/<branch>` 대신 `environment:<name>` 이 된다. 하나만 넣으면 그 잡만
  AccessDenied 가 된다(이미지 빌드는 통과하고 배포만 실패했다).
  실제 sub 는 저장소 로그가 아니라 **CloudTrail 의 `userIdentity.userName`** 에서 확인한다.
- **`docker/build-push-action` 은 기본으로 provenance attestation 을 붙여
  `application/vnd.oci.image.index.v1+json` 으로 푸시한다.** Lambda·AgentCore 는 이 형식을
  거부하므로 `provenance: false`, `sbom: false`, `outputs: type=image,oci-mediatypes=false,push=true`
  가 필요하다. `latest` 가 이 형식으로 덮어써지면 스택 배포가 롤백된다.
- 이미지 빌드는 `ubuntu-24.04-arm` 네이티브 러너에서 한다(공개 저장소는 무료).
  QEMU 크로스 빌드는 매우 느리고, amd64 러너에서 arm64 이미지를 `docker pull`·`create` 하면
  `no matching manifest for linux/amd64` 가 난다. 정적 자산 추출도 arm64 잡에서 하고
  아티팩트로 배포 잡에 넘긴다.
- `concurrency.cancel-in-progress` 를 워크플로 전체에 `false` 로 두지 않는다. 실패가 확정된
  낡은 실행이 큐를 막는다. 취소를 막아야 하는 것은 `cdk deploy` 잡뿐이므로 그 잡에만
  별도 concurrency group 을 준다.
- 배포 컨텍스트(hostedZoneId·certificateArn·distributionId·agentRuntimeArn·모델 프로파일 ARN)를
  하나라도 빼고 `cdk deploy` 하면 **해당 설정이 제거된 상태로 배포된다.** 도메인 별칭과
  Route53 레코드가 사라지고 Lambda 환경변수가 빈다. 로컬은 gitignored `cdk.context.json`,
  CI 는 GitHub Variables 로 채우고 누락 시 배포 전에 실패시킨다.

## AgentCore Runtime 계약

- **`AWS_REGION` 을 주지 않는다.** Lambda 는 자동으로 넣어주지만 AgentCore Runtime 은 아니다.
  없으면 SDK 클라이언트 생성에서 즉시 실패해 모든 분석 요청이 500 이 된다.
  Runtime `EnvironmentVariables` 에 명시한다(`infrastructure/lib/pipeline-stack.ts`).
- `/ping` 응답의 `status` 는 **`Healthy` 또는 `HealthyBusy`** 여야 한다(소문자 불가).
  `time_of_last_update` 는 상태가 실제로 바뀔 때만 넣는다 — 매 ping 마다 갱신하면
  유휴 세션 타임아웃이 발동하지 않아 세션 쿼터를 소진한다.
- **런타임은 컨테이너의 500 을 `RuntimeClientError` 로 감싸 호출자에게 사유를 주지 않는다.**
  그래서 예외를 반드시 로그로 남겨야 한다. stderr 가 수집되지 않는 경우가 있어
  `console.log`(stdout)을 쓴다. 로그가 없으면 원인 추적이 불가능하다.
- 헬스체크는 2초 간격이다. `/ping` 에 로그를 남기면 CloudWatch 비용이 계속 발생한다.
- **Strands SDK 는 스트리밍으로 모델을 호출한다.** IAM 에 `bedrock:InvokeModel` 만 주면
  `InvokeModelWithResponseStream` 이 없어 모든 모델 호출이 AccessDenied 가 된다.
  `ConverseStream` 까지 함께 부여한다(웹 Lambda 역할도 같다).
- **라벨 인식은 AgentCore 가 아니라 `lib/agent/labelDirect.ts` 로 Bedrock 을 직접 호출한다.**
  에이전트 경로는 프롬프트에 S3 키를 문자열로만 넘겨 모델이 이미지를 볼 수 없어
  항상 `recognized: false` 였다. 되살리려면 이미지 바이트를 모델 입력에 실어야 한다.
- **유료 API 호출을 모델 자율 판단(도구)에 맡기지 않는다.** 라벨 에이전트에 `webSearch` 를
  도구로 줬더니 인식이 실패한 상황에서도 검색을 호출했다. SerpAPI 무료 티어는 월 100회다.
  검색은 빈 필드가 있을 때만 코드가 한 번 부르도록 통제한다(`lib/agent/labelEnrich.ts`).
- 원인 분리가 막히면 **같은 이미지를 로컬에서 `docker run` 해 같은 요청을 보낸다.**
  실제로 이 방법으로 `AWS_REGION` 누락을 찾았다(런타임 로그만으로는 보이지 않았다).

## Next.js

- 미들웨어에서 AWS SDK·`node:crypto` 를 쓰려면 `experimental.nodeMiddleware` 가 필요하다
  (Edge 런타임에서는 불가).
- `distDir` 는 `NODE_ENV` 로 분기한다(dev `.next`, prod `.next-prod`). dev 서버가 도는 중에
  같은 디렉토리로 빌드하면 청크가 섞여 `a[d] is not a function` 이 난다.
- `robots.ts` 같은 메타데이터 라우트는 빌드 시점에 런타임 설정을 요구하면 안 된다.

## S3 / 업로드

- **미디어 버킷에 CORS 규칙이 있어야 한다.** 브라우저가 사전 서명 URL 로 S3 에 직접 PUT 하므로
  규칙이 없으면 preflight 가 막혀 업로드가 네트워크 오류로 실패한다
  ("사진 저장소에 연결하지 못했습니다"). 오리진은 서비스 도메인으로 한정한다 —
  `*` 로 열면 유출된 사전 서명 URL 을 다른 사이트에서 쓸 수 있다.
  진단은 `curl -X OPTIONS -H 'Origin: <도메인>' -H 'Access-Control-Request-Method: PUT'` 이다.
- 사전 서명 PUT 에는 `requestChecksumCalculation: 'WHEN_REQUIRED'` 를 준다.
  기본값이면 `x-amz-checksum-crc32` 헤더 때문에 서명 불일치로 거부된다(실제 AWS 에서도).
- 라벨 사진은 반드시 실제로 업로드된 키를 쓴다(`POST /api/labels/upload`).
  가짜 `imageKey` 를 만들어 넘기던 버그가 있었다.
- HEIC 는 브라우저에서 바로 못 읽는다. Safari 는 캔버스, 그 외는 서버 변환
  (`POST /api/labels/convert`, heic-convert)으로 우회한다.

## 인증

- 세션 쿠키는 리다이렉트 응답 객체에 직접 설정해야 실린다.
- **리다이렉트 대상을 `request.nextUrl.origin` 으로 만들지 않는다.** CloudFront 오리진 요청
  정책이 `host` 를 제외하므로(OAC 서명 충돌 방지) Next.js 가 원래 호스트를 알 수 없고
  컨테이너 내부 주소(`https://0.0.0.0:3000`)를 origin 으로 계산한다. 실제로 Google 로그인 후
  그 주소로 튕겼다(쿠키는 정상 발급되어 되돌아가면 로그인된 상태였다).
  `lib/config.ts` 의 `absoluteUrl()` 로 `APP_BASE_URL` 기준 절대 URL 을 만든다.
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
