# 스파이크 결과 (task 2.6)

> 최초 기준일: 2026-07-29 · **갱신: 2026-07-30 (2.4 실측)**
> 범위: 로컬에서 확인 가능한 항목 + 로컬 파이프라인 러너로 실제 AWS 를 호출해 측정한 항목.

## 요약

| 스파이크 | 상태 | 결과 |
| --- | --- | --- |
| 2.2 ARM64 컨테이너 → AgentCore Runtime 배포 및 `/invocations`·`/ping` | **미확인 (배포 필요)** | 코드·Dockerfile·엔드포인트 구현 완료, 로컬 단위 테스트로 요청/응답 계약만 검증 |
| 2.3 세션 지속성(동일 `runtimeSessionId` 2회 호출) | **미확인 (배포 필요)** | SDK API 가 설계 전제와 달라 대체 구성 확정 (아래 참조) |
| 2.4 Transcribe `ko-KR` 화자분리 품질 | **부분 확인 — 경고** | 실제 녹음 1건에서 **화자분리 실패(1명으로 판정)**. 아래 상세 |
| 2.4 F0 gap 임계값(60Hz/30Hz) 타당성 | **미확인** | 화자분리가 안 돼 두 화자 F0 비교 자체가 불가. 두 사람이 번갈아 말하는 녹음 필요 |
| 2.5 ADOT 자동 계측으로 스팬 수집 | **미확인 (배포 필요)** | `@opentelemetry/api` 의존성만 추가, 트레이스 기록 계층은 구현 |

**판단:** 2.2·2.5 는 *미확인*(배포 대기)이다. **2.4 는 경고 신호가 나왔다** — 설계의 화자 기반 기능(화자별 반응 대비, 반응 일치도)이 성립하는지 추가 측정이 필요하다.

## Strands Agents TypeScript SDK 1.11.2 — 설계 전제와 다른 점

design.md 는 Python SDK 기준 API 를 전제했으나, TypeScript SDK 는 다음이 다르다. **패키지의 `.d.ts` 를 직접 읽어 확인했다.**

| 설계 전제 | 실제 (1.11.2) | 대응 |
| --- | --- | --- |
| `GraphBuilder` 로 그래프 구성 | 없음. `new Graph({ nodes, edges })` 선언형 + `Node` 추상 클래스 | 파이프라인은 프레임워크 비의존 자체 그래프(`agent/src/graph/`)로 정의하고 모델 호출 노드만 Strands `Agent` 사용. design.md 원칙 6(프레임워크 중립 계약)에 부합 |
| `S3SessionManager` | 없음. `SessionManager` + `S3Storage`(`@strands-agents/sdk/storage`) 조합 | `agent/src/lib/session.ts` 에서 조합해 사용 |
| 의존성 부담 없음 | `zod ^4.1.12` 를 피어로 요구 | 저장소 전체를 **zod 4** 로 통일 |
| — | node 엔트리(`index.node.js`)가 `@modelcontextprotocol/sdk` 를 하드 임포트 | agent 의존성에 추가 (없으면 런타임 모듈 해석 실패) |

의존성 그래프상 Graph 의 의미론도 Python 과 다르다(엣지 AND 조건, 노드 개별 스케줄링, 에이전트 노드 기본 무상태). 자체 실행기를 쓰기로 한 이유 중 하나다.

## 2.4 Transcribe 한국어 화자분리 — 실측 (2026-07-30)

### 측정 방법

배포 없이 측정하기 위해 로컬 파이프라인 러너(`scripts/analyze-local.ts`)를 만들었다.
배포판 파이프라인(세션 A/B)과 같은 순서로 같은 레코드를 남기며, 각 단계를 다음으로 대체한다.

| 단계 | 로컬 대체 |
| --- | --- |
| 음향 특징 | `audio/.venv` 로 `extract_features_from_wav` 직접 호출 |
| 트랜스크립션 | **실제 Amazon Transcribe** (`ko-KR`, `ShowSpeakerLabels`, `MaxSpeakerLabels: 2`) |
| 화자 매핑 | `lib/domain/speaker.ts` (설계 그대로) |
| 소믈리에 분석 | Bedrock 직접 호출 (`lib/agent/sommelierDirect.ts`) |

입력: 실제 시음 녹음 1건 (webm/opus, 32.9초, 모노, 브라우저 녹음).

### 결과 — 화자분리 실패

```
speaker_labels.segments : 6개 — 전부 spk_0
speaker_labels.speakers : 1
items                   : 39개 — 전부 spk_0
```

`MaxSpeakerLabels: 2` 를 줬는데도 **Transcribe 가 화자를 1명으로 판정**했다.
전사 내용에는 주고받는 대화로 들리는 부분("응? 왜?", "맛이 어때?")이 있으나 분리되지 않았다.

원인 가설(미검증):
- 한쪽 화자가 발화의 대부분을 차지하고, 다른 화자의 발화가 매우 짧다(1~2음절 반응).
- 모노 단일 마이크 녹음이라 공간적 단서가 없다.
- 33초는 화자 모델을 만들기에 짧을 수 있다.

### 파이프라인 동작은 설계대로였다

- `mappingConfidence: none`, `mapping: null` — 억지 매핑을 하지 않았다.
- 소믈리에가 실명 없이 "한 화자가…" 로 서술했다 (R5 준수).
- 반응 일치도(`agreementScore`) 미산출.
- F0 유효 프레임 732/3291 (22%) — 발화·침묵 혼재 구간으로 정상 범위.

### 전사 품질 (참고)

쓸 만한 수준이다. 와인 표현이 대체로 살아남았다.

> "약간. 바닐라향도 좀 많은 것 같고 맛있는 거지 … 약간 이 색깔을 딱 내가 좋아하는 색깔이야 음 맛있어."

오인식: "좀 아실거"(도입부), "맛스타". 하이라이트 3건은 모두 실제 발화에서 인용됐고,
5축은 언급된 축만 채워졌다(body 4 / aroma 4 / finish 3.5, 산미·타닌은 언급 없어 생략).

### 이 결과가 설계에 갖는 의미

화자분리가 안 되면 다음이 성립하지 않는다.

- R6 두 화자 대비 코멘트
- R6/R7 반응 일치도(`agreementScore`)와 월별 추이
- R8 탐색 축 `speakerAgreementBand`
- F0 gap 임계값(60Hz/30Hz) 자체가 무의미해진다 — 비교 대상이 없다

### 다음 측정 (필요)

1. **두 사람이 번갈아 충분히 말하는 녹음**(각자 5회 이상, 30초~1분)으로 재측정.
   - 분리되면 → F0 gap 실측값을 모아 임계값 타당성 확인
   - 계속 1명으로 잡히면 → 아래 대안 검토
2. 대안
   - 각자 다른 기기로 녹음해 2트랙을 만든다(분리 문제 자체를 제거, 대신 기록 절차가 번거로워진다)
   - 화자분리를 자체 구현한다 — 이미 F0 트랙이 있으므로 발화 구간을 F0 중앙값으로 2군 클러스터링
   - 화자 기반 기능을 Phase 2 로 미루고, 단일 화자 서술로 MVP 를 마감한다



1. **GSI 인덱스명 대소문자 불일치** — 리포지토리는 `gsi1`, CDK 는 `GSI1` 을 만들고 있었다. 모든 목록 조회가 배포 직후 `ValidationException` 으로 실패했을 결함이며, 단위 테스트가 잘못된 값(`gsi1`)을 고정해 두어 통과하고 있었다. `GSI1_INDEX_NAME` 공유 상수로 통일하고 테스트를 CDK 기준으로 교정했다. **E2E(DynamoDB Local)가 없었으면 배포 후에 발견됐을 항목이다.**
2. **취향 프로파일 5축 평균 스키마 위반** — `TasteProfile.axes` 가 개별 노트용 0.5 단위 검증기를 재사용해, 평균값(예: 3.4)을 저장하려 하면 항상 검증 실패했다. `TastingNotesAverage` 를 분리하고 도메인 산출물의 스키마 정합성 회귀 테스트를 추가했다.
3. **시음 상세에 AI 요약 미표시** — 요약이 메타데이터에만 쓰이고 본문에 렌더되지 않았다. 요약 섹션을 추가했다(수정본 우선, 원본 보존 표기).
4. **CloudFront 오리진 플레이스홀더 / 스택 순환 의존** — 기본 오리진이 `example.com` 이었고, 미디어 버킷에 OAC 정책을 붙이는 과정에서 `DataStack ↔ WebStack` 순환 의존이 발생해 `cdk synth` 가 실패했다. 이름 기반 임포트(`fromBucketName`·`fromRepositoryName`) + 미디어 버킷 정책을 소유 스택에서 계정 범위 조건으로 부여하는 방식으로 해소했다.
5. **라벨 사진이 업로드되지 않고 있었다** (2026-07-30) — 기록 화면이 `labels/${Date.now()}-${file.name}` 형태의 **가짜 키**를 만들어 인식 API 에 넘겼다. S3 에 객체가 없으니 배포 후에도 실패할 경로였다. 사전 서명 업로드(`POST /api/labels/upload`)를 추가하고 실제 PUT 후 그 키로 인식하도록 고쳤다.
6. **사전 서명 PUT 이 체크섬 때문에 거부됐다** (2026-07-30) — AWS SDK v3 는 `PutObject` 에 `x-amz-checksum-crc32` 를 요구하도록 서명하는데, 브라우저는 사전 서명 URL 로 PUT 할 때 그 헤더를 보내지 않아 `InvalidRequest` 가 났다. `requestChecksumCalculation: 'WHEN_REQUIRED'` 로 해소. **실제 AWS 에서도 같은 문제가 났을 항목이다.**
7. **무음 녹음이 분석 실패로 처리됐다** (2026-07-30) — 발화가 없으면 5축 노트·평점을 만들 수 없는데 `SommelierOutput` 이 이를 필수로 요구해, 스키마 검증 3회 실패 후 작업이 `failed` 로 떨어졌다. R5("트랜스크립트 무음을 실패로 처리하지 않는다")와 어긋나므로 `aiRating`·`notes` 를 선택으로, `highlights` 를 빈 배열 허용으로 완화하고 화면에 안내를 넣었다.
8. **로컬 더미 자격증명이 Bedrock 호출을 가로막았다** (2026-07-30) — `.env.local` 의 `AWS_ACCESS_KEY_ID=local` 이 같은 프로세스의 모든 AWS 호출에 적용되어 라벨 인식(Bedrock)이 인증 실패했다. DynamoDB Local·S3 클라이언트에만 더미 자격증명을 주입하도록 바꿨다.

## 로컬 환경 사실

- `praat-parselmouth` 0.4.3 은 macOS arm64 / Python 3.11 에서 설치·동작 확인. 그럼에도 scipy 자기상관 폴백을 별도 구현해 두 경로가 동일한 `{t, hz}` 출력을 내도록 했다(Lambda 이미지 빌드 실패 대비).
- `ffmpeg` 는 로컬에 존재하지만 테스트는 정규화 단계를 모킹해 ffmpeg 없이도 통과한다.
- 에이전트 번들은 4.3MB(esbuild). AgentCore 이미지 2GB 상한 대비 여유가 크다.
- Next 15.5 에서 미들웨어가 Node.js 런타임을 필요로 한다(`experimental.nodeMiddleware`). Edge 런타임에서는 속도 제한이 쓰는 AWS SDK v3 와 `node:crypto` 가 동작하지 않는다.
- **로컬에는 S3 가 필요하다** — 브라우저가 사전 서명 URL 로 직접 PUT 하므로, 로컬 S3(LocalStack, `npm run s3:up`) 없이는 실제 AWS 로 요청이 나가 CORS·버킷 부재로 실패한다. 버킷 CORS(PUT 허용)도 함께 설정해야 한다.
- **HEIC 는 서버에서 변환해야 한다** — 아이폰 기본 포맷인 HEIC 는 (1) 라벨 인식 모델이 읽지 못하고 (2) Chrome 계열이 디코딩하지 못한다. `heic-convert` 로 서버 변환(3.38MB → 1.5초)하고, Safari 처럼 디코딩 가능한 브라우저는 클라이언트에서 처리한다.

## Bedrock 오디오 입력 조사 (2026-07-30)

"Transcribe 대신 Claude 로 전사"가 가능한지 확인했다. **불가능하다.**

| 후보 | 오디오 입력 | 확인 방법 |
| --- | --- | --- |
| Claude (haiku 4.5 / sonnet 4.6) | ❌ | Converse 호출 시 `ValidationException` — 허용 키 목록(`text, image, toolUse, toolResult, document, video, cachePoint, reasoningContent`)에 audio 없음 |
| Amazon Nova (pro/lite/micro/2-lite) | ❌ | `inputModalities` = TEXT/IMAGE/VIDEO |
| OpenAI `gpt-oss` 4종 (us-east-1, us-west-2) | ❌ | `inputModalities` = TEXT |
| `nova-2-multimodal-embeddings` (us-east-1) | ⭕ 오디오 | 임베딩만 생성 — 전사 아님 |

Converse API 자체에는 `audio` 콘텐츠 블록이 정의되어 있으나(SDK `AudioBlock`),
ap-northeast-2·us-east-1 에서 이를 받아 텍스트를 내는 모델이 없다.
→ **전사는 Amazon Transcribe 를 계속 쓴다.** 설계 변경 없음.



## 다음에 확인해야 할 것

**우선순위 1 — 화자분리 재측정 (계정 준비 불필요, 지금 가능)**

두 사람이 번갈아 충분히 말하는 녹음으로 재측정한다. 명령은 하나다.

```
npm run analyze:local -- <tastingId>
```

이 결과가 화자 기반 기능(반응 일치도, 화자 대비, `speakerAgreementBand` 축)의 존폐를 가른다.

**계정 준비 후**

1. 리전 확정 — AgentCore Runtime · 사용 모델 · Transcribe `ko-KR` 이 모두 있는 리전 (작업 0.1)
   - 참고: 라벨 인식·소믈리에 분석은 ap-northeast-2 에서 추론 프로파일(`global.anthropic.claude-*`)로 호출 확인됨.
     온디맨드 모델 ID 직접 호출은 거부되므로 **추론 프로파일 ID 를 써야 한다.**
2. `AWS::BedrockAgentCore::Runtime` 의 실제 속성 스키마. 현재 `CfnResource` 로 선언했고 상한값(`maxIterations` 12 / `timeoutSeconds` 300 / `idleRuntimeSessionTimeout` 60 / `maxLifetime` 900)을 넣었으나 **배포 전 속성명 재확인이 필요하다.**
3. us-east-1 인증서 발급 후 `certificateArn` 컨텍스트 주입 → 도메인 별칭 활성화
4. 배포 후 라벨 인식·소믈리에 분석을 AgentCore 경로로 전환하고, 로컬 직접 호출 경로
   (`WAGANDA_LABEL_FALLBACK=bedrock`)가 프로덕션에서 꺼져 있음을 확인한다.

## 로컬 검증에 만든 도구 (참고)

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | DynamoDB Local + LocalStack S3 기동 후 개발 서버 |
| `npm run db:up` / `db:reset` / `db:down` | 로컬 DynamoDB 제어·시드 |
| `npm run s3:up` / `s3:down` | 로컬 S3(버킷·CORS 포함) 제어 |
| `npm run dev:login` | 로컬 편집자 세션 발급 (dev/prod 에서는 실행 거부) |
| `npm run analyze:local -- <tastingId>` | 분석 파이프라인 로컬 실행 (Transcribe·Bedrock 실호출) |

Transcribe 입력용 버킷은 `waganda-transcribe-local-<AWS 계정 ID>` (ap-northeast-2)이며
퍼블릭 접근 차단 + 1일 자동 삭제로 만들었다. 러너는 작업 완료 직후 입력 파일을 삭제한다
(개인 음성을 클라우드에 남기지 않는다).
