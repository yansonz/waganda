# agent 워크스페이스 아키텍처 리뷰

> 작성일: 2026-08-04
> 범위: `agent/` 워크스페이스(분석 파이프라인) 전반. 코드베이스를 직접 읽고 정리했다.
> 관련 문서: `docs/issues/spike-findings.md`(SDK 실사·화자분리 실측), `docs/issues/agentcore-review.md`(관리형 기능 도입 판단), `.kiro/steering/pitfalls.md`

## 1. 한 줄 요약

**Strands `@strands-agents/sdk` 1.11.2 는 오케스트레이션 프레임워크가 아니라 "모델 호출 컴포넌트"로만 쓴다.**
파이프라인 자체(단계 순서, 재시도, 스킵, 조건부 실행)는 프레임워크에 의존하지 않는 자체 그래프
(`agent/src/graph/`)로 직접 구현했다. 이유는 design.md 가 전제한 `GraphBuilder`·`S3SessionManager`
가 실제 SDK 1.11.2 에 존재하지 않기 때문이다(스파이크에서 `.d.ts` 를 직접 읽어 확인).

## 2. 왜 이 구조인가 — 설계 결정의 근거

### 2.1 SDK 실사와 설계 이탈

| design.md 전제 | 실제 (1.11.2) | 대응 |
|---|---|---|
| `GraphBuilder` 로 그래프 구성 | 없음. `new Graph({ nodes, edges })` 선언형 + `Node` 추상 클래스만 존재, 노드=에이전트/서브그래프 전제가 강함 | 자체 그래프(`graph/pipeline.ts` + `graph/executor.ts`)로 대체 |
| `S3SessionManager` | 없음. `SessionManager` + `S3Storage`(`@strands-agents/sdk/storage`) 조합 | `lib/session.ts` 에서 직접 조합 |
| 의존성 깨끗함 | zod `^4.1.12` 를 피어로 요구 | 워크스페이스 전체를 zod 4 로 통일 |
| — | node 엔트리가 `@modelcontextprotocol/sdk` 하드 임포트 | MCP 미사용이어도 의존성에 남겨둠 |

이 파이프라인의 노드 대부분(ensureJob, startTranscription, extractAcoustic, loadState, mapSpeakers,
refreshProfile/runDiscovery 의 조건 판정, persistAndPublish)은 **모델을 호출하지 않는 순수 결정
로직**이다. Strands `Node` 를 상속해 억지로 감싸면 프레임워크의 스트리밍·스냅샷·인터럽트 기능을
전혀 안 쓰면서 복잡도만 떠안는다. 재개 정합성의 원천도 Strands 세션 의미론이 아니라 DynamoDB
`Job.completedSteps` 이므로, `Graph` 의 재개 메커니즘이 필요 없다.

**결론:** Strands 를 안 쓰는 게 아니라, 강점(모델 오케스트레이션)이 필요한 지점 — 소믈리에 분석,
취향 프로파일 서술, 발견 후보 제시, 라벨 인식(비활성) — 에만 `Agent` 클래스로 국한한다.

### 2.2 관리형 오케스트레이션(Bedrock Agents)을 도입하지 않은 이유

`docs/issues/agentcore-review.md` 의 판단: 관리형 에이전트가 값을 주는 조건은 "모델이 다음 행동을
스스로 골라야 할 때"다. 이 파이프라인의 단계는 고정 순서이고, 모델이 판단할 여지가 있는 지점은
실질적으로 `sommelierAnalysis` 하나뿐이며 출력은 zod 스키마로 고정된다. 오케스트레이션 루프를
얹으면 모델이 순서를 틀릴 자유가 생기고, 판단 토큰이 추가로 들고, 실패 지점이 늘어나며 "어느
노드에서 깨졌는지 Job 레코드로 즉시 알 수 있는" 현재의 명확함을 잃는다.

같은 이유로 AgentCore 장기 메모리로 취향 프로파일(`buildTasteProfile`)을 대체하지 않는다 — 이미
DB 기록에서 결정론적으로 계산되어 근거 추적·재현성·비용 모두 현재 방식이 낫다.

## 3. 실행 환경 계약

- **AgentCore Runtime**(ARM64 컨테이너, `linux/arm64`, 이미지 상한 2GB)에서 서빙.
- 진입점(`entrypoint.ts`)은 Node `http` 서버로 `POST /invocations`, `GET /ping` 을 8080 포트에 직접
  구현한다 — 프레임워크의 서버 레이어를 쓰지 않는다.
- `/ping` 응답은 `{ status: 'Healthy' }` 만 반환한다. `time_of_last_update` 를 넣지 않는 것이 의도적
  결정이다 — 매 ping 마다 갱신하면 유휴 세션 타임아웃이 발동하지 않아 세션 쿼터를 소진한다.
- 500 에러는 AgentCore 가 `RuntimeClientError` 로 감싸 원인을 숨기므로, 모든 예외를 stdout
  (`console.log`)에 남긴다. stderr 가 수집되지 않는 경우가 있었다.
- **`AWS_REGION` 을 런타임 환경변수로 명시해야 한다.** Lambda 와 달리 AgentCore Runtime 은 자동
  주입하지 않는다(`infrastructure/lib/pipeline-stack.ts` 의 `EnvironmentVariables` 참고).
- 모델은 온디맨드 ID 가 아니라 **추론 프로파일 ARN**(`MODEL_INFERENCE_PROFILE_ARN`)으로만 호출한다.
- IAM 은 `InvokeModel`/`Converse` 뿐 아니라 **`InvokeModelWithResponseStream`/`ConverseStream`** 도
  필요하다 — Strands SDK 가 기본적으로 스트리밍 호출을 하기 때문이다.

## 4. task 라우팅 (entrypoint.ts)

`AgentInvocation` 스키마(`@waganda/schemas`)의 `task` 필드로 3갈래 분기:

| task | 세션 | 처리 |
|---|---|---|
| `analyze_upload` | 세션 A | `ensure_job → start_transcription → extract_acoustic` (모델 호출 없음) |
| `analyze_transcribed` | 세션 B | `load_state → map_speakers → sommelier_analysis → (조건부)refresh_taste_profile → (조건부)run_discovery → persist_and_publish` |
| `analyze_label` | 단발 | 라벨 인식 에이전트 동기 호출 — **실사용 경로 아님**(4.3절 참고) |

두 세션 모두 실행 전 예산 가드(`checkAndReserveBudget`, 4.6절)를 통과해야 하고, 실행 후
`Job.completedSteps` 를 병합 저장해 다음 재시도의 스킵 판정 기준을 만든다.

## 5. 파이프라인 그래프 — 자체 구현 오케스트레이터

### 5.1 데이터로서의 그래프 (`graph/pipeline.ts`)

그래프는 순수 데이터로 선언한다: `PipelineNode`(이름 + `shouldRun` 술어 + `run` 함수) 배열과
`PipelineEdge`(from/to + 조건부 `when`) 배열. `PipelineContext` 가 노드 간 공유 가변 상태
(`data`, `newlyCompletedSteps`, `skippedSteps`, `error`)를 담는다.

### 5.2 실행기 (`graph/executor.ts`)

`executePipeline()` 이 소스 노드부터 엣지를 따라 순차 방문한다. 이 파이프라인은 분기 없는 단일
경로(조건부 노드가 있어도 "실행하거나 건너뛰거나"일 뿐 병렬 분기가 아님)이므로 위상정렬이
불필요하다.

실행 규칙:
- 노드가 이미 `completedSteps` 에 있으면 무조건 스킵 (재시도 시 중복 실행 방지).
- `shouldRun` 이 있고 false 면 완료 처리 없이 스킵 (조건부 노드).
- 한 노드가 실패하면 그래프 전체를 멈추고 `ok: false` + `ctx.error` 를 반환한다 — 예외를 위로
  던지지 않고, 호출부가 부분 결과를 그대로 저장/보존할 수 있게 한다.

### 5.3 세션 A (`graph/sessionA.ts`)

```
ensure_job → start_transcription → extract_acoustic
```
모델 호출 없음. 업로드 직후 즉시 실행된다.

- **ensure_job**: Job 레코드 생성/조회(멱등). 이미 `analyzing` 이상이면 세션 A 전체를 조기
  종료하는 판정은 이 노드가 아니라 `entrypoint.ts` 의 `handleAnalyzeUpload` 가 담당.
- **start_transcription**: Transcribe 작업명을 `waganda-<tastingId>-<recordingId>` 로 **결정론적**
  생성해 재시도 시 같은 이름을 재사용(중복 생성 방지). `ko-KR` 고정, 화자분리 최대 2명.
- **extract_acoustic**: 오디오 Lambda(컨테이너, ARM64)를 `InvokeCommand` 로 호출. `Recording.acoustic`
  이 이미 있으면 재호출하지 않는다.

### 5.4 세션 B (`graph/sessionB.ts`)

```
load_state → map_speakers → sommelier_analysis
  → (조건부)refresh_taste_profile → (조건부)run_discovery → persist_and_publish
```

- **load_state**: Transcribe 상태가 `FAILED` 면 예외를 던진다. 트랜스크립트가 무음/공백이어도
  실패로 처리하지 않고 `isSilentTranscript` 플래그만 데이터에 남긴다(제품 정책 — "무음도 실패가
  아니다").
- **map_speakers**: 순수 함수 `@app/domain/speaker.mapSpeakers` 를 호출하는 얇은 어댑터. 화자분리
  자체가 실패하면 도메인 함수가 `mappingConfidence: 'none'` 을 반환하고, 이 노드는 그 결과를
  그대로 저장한다.
- **sommelier_analysis**: **이 그래프에서 유일하게 모델을 호출하는 필수 노드.** Strands `Agent.invoke()`
  결과를 `lib/validate.ts` 의 `validateWithRetry` 로 Zod 검증하며, 최대 2회 재생성(총 3회 시도) 후
  실패하면 노드가 예외를 던져 그래프를 중단시킨다. 원본 오디오·트랜스크립트는 이미 저장되어 있어
  별도 보존 조치가 필요 없다.
- **refresh_taste_profile** (조건부): 완료 시음 수가 5의 배수일 때만 실행. `shouldRun` 판정은
  `@app/domain/profile.shouldRefreshProfile` 결정론적 술어 — "지금 갱신할지"를 모델에게 묻지 않는다.
  수치(`liked`/`disliked`/`axes`)는 순수 함수가 계산하고, 에이전트는 narrative 서술만 생성한다.
- **run_discovery** (조건부): 완료 시음 10건 이상 + 마지막 실행 이후 5건 이상 증가 시 실행. 등급
  판정(`gradeDiscovery`)과 중복 차단(`isDuplicate`)은 결정론적 코드가 전담, 에이전트는 후보만
  제시. 파싱 실패 시 그래프를 중단시키지 않고 조용히 스킵(발견은 부가 기능).
- **persist_and_publish**: **쓰기는 결정론적 노드에서만 수행한다는 원칙이 구현되는 지점.** 소믈리에
  에이전트 출력을 실제로 DynamoDB 에 쓰는 유일한 지점이며, Job 을 `completed` 로 전환하고
  CloudFront `/*` 무효화를 발행한다.

### 5.5 재개 전략

파이프라인 재시도(세션 A/B 재호출, SQS 재구동)의 정합성은 전적으로 DynamoDB `Job.completedSteps`
에 있다. Strands 세션(대화 맥락) 복원이 기대와 다르게 동작해도 그래프 실행 결과는 영향받지
않는다 — 이것이 자체 그래프를 선택한 핵심 이유 중 하나다.

## 6. 모델을 호출하는 4개 에이전트 (`agents/`)

전부 `Agent` 를 얇게 감싸는 팩토리이며 공통 패턴:
- `model: Model` 을 주입 가능하게 한다 (프로덕션 `BedrockModel`, 테스트는 가짜 모델).
- `tools: buildReadonlyTools(...)` — 아래 7절 참고.
- `structuredOutputSchema` 로 출력 zod 스키마를 강제.
- `printer: false`.

| 에이전트 | 파일 | 출력 스키마 | 상태 |
|---|---|---|---|
| 소믈리에 | `agents/sommelier.ts` | `SommelierOutput` | **실사용** (세션 B 필수 노드) |
| 취향 프로파일 | `agents/tasteProfile.ts` | `TasteProfileNarrativeOutput`(narrative/recommendations/shoppingGuide만, 수치는 도메인 함수가 계산) | **실사용** (조건부) |
| 패턴 발견 | `agents/discovery.ts` | `DiscoveryAgentOutput`(candidates, 등급 없음) | **실사용** (조건부) |
| 라벨 인식 | `agents/label.ts` | `LabelExtraction` | **비활성** — 4.3절 참고 |

### 6.1 라벨 인식 에이전트가 비활성인 이유

`POST /api/labels/analyze` 는 이 에이전트가 아니라 `lib/agent/labelDirect.ts` 로 Bedrock 을 직접
호출한다. 되살리려면 두 가지를 먼저 고쳐야 한다:

1. `entrypoint.ts` 의 `handleAnalyzeLabel` 은 프롬프트에 S3 키를 **문자열로만** 넘긴다 — 모델이
   이미지에 접근할 수 없어 항상 `recognized: false` 였다. S3 바이트를 읽어 이미지 블록으로
   실어야 한다.
2. `webSearch` 를 도구로 주면 인식이 이미 실패한 상황에서도 모델이 자율적으로 검색을 호출했다
   (실측 확인). SerpAPI 무료 티어는 월 100회라 낭비가 크다. 검색은 `lib/agent/labelEnrich.ts`
   방식처럼 **빈 필드가 있을 때만 코드가 통제된 방식으로 1회 호출**해야 한다.

이 결정은 "유료 API 호출을 모델 자율 판단(도구)에 맡기지 않는다"는 프로젝트 전반 원칙으로
이어졌다.

## 7. 도구 계층 — 읽기 전용 불변식 (R10)

`tools/index.ts` 가 Strands `tool()` 팩토리로 감싸는 얇은 바인딩이고, 실제 로직은
`tools/catalog.ts`(`getWine`, `findWines`), `tools/tastings.ts`(시음/프로파일/발견 조회),
`tools/stats.ts`(`computeStats`), `tools/web.ts`(`webSearch`)의 순수 함수가 담당한다.

**모든 도구는 읽기 전용이다.** `tools/index.ts` 는 Repository 의 `put*`/`patch*`/`delete*` 를 이
클로저에서 절대 import 하지 않으며, `test/tools-readonly.test.ts` 가 `READONLY_TOOL_NAMES`
화이트리스트로 정적 검증한다. 새 도구를 추가하면 이 화이트리스트도 함께 갱신해야 한다.

`computeStats` 는 "임의 코드나 SQL 이 아니라 제한된 스펙(`ComputeStatsSpec`)만 받는다"는 도구
계약의 예시다 — groupBy/metric/minSampleSize 범위가 Zod 스키마 단계에서 이미 제한된다.

## 8. 안전장치

### 8.1 프롬프트 인젝션 방어 (`prompts/common.ts`)

모든 에이전트 시스템 프롬프트 맨 앞에 `INJECTION_GUARD_INSTRUCTION` 을 공통 삽입한다. 트랜스크립트,
라벨 이미지, 웹 검색 결과는 신뢰할 수 없는 외부 데이터로 명시하고, 그 안의 지시문을 따르지 않도록
못박는다. 도구가 전부 읽기 전용(R10)이라 인젝션이 성공해도 데이터 변조·삭제는 불가능하지만,
서술 왜곡·역할 이탈은 이 지시문으로 방어하는 2차 방어선이다.

### 8.2 출력 스키마 검증 + 재생성 (`lib/validate.ts`)

`validateWithRetry` — Zod 검증 실패 시 최대 2회 재생성(총 3회 시도), 실패 사유를 다음 시도
프롬프트에 반영한다. 모두 실패하면 예외를 던지지 않고 `ok: false` 를 반환해, 호출부가 작업을
`failed` 로 전환하고 원본을 보존하는 결정을 내리게 한다.

### 8.3 예산 가드레일 (`lib/budget.ts`)

일간 실행 횟수 상한 + 월간 모델 비용 예산의 2중 하드 가드. `evaluateBudget` 은 순수 판정 함수,
카운터 조회/증가는 `BudgetCounters` 인터페이스로 주입받는다(현재 `entrypoint.ts` 의 인메모리
구현은 임시이며 프로세스 수명 동안만 유효 — 실서비스는 DynamoDB 조건부 증가로 교체 예정으로
코드에 명시되어 있다). 차단이 아니면 판정과 동시에 카운터를 증가시켜(예약) 과다 집계 방향으로
보수적으로 설계했다.

### 8.4 세션 ID 규칙 (`lib/session.ts`)

`buildRuntimeSessionId(tastingId, env)` 가 `waganda-tasting-<tastingId>-<env>` 형태의 결정론적
세션 ID 를 만든다. AgentCore 최소 길이(33자) 미달 시 `tastingId` 자체를 반복해 결정론적으로
패딩한다(무작위 패딩은 세션 A/B 재호출 시 동일 ID 재생성이 불가능해지므로 금지). 이 세션은
Strands `Agent` 의 대화 맥락 지속성 편의 기능일 뿐이며, 파이프라인 재개 정합성과는 무관하다
(5.5절).

### 8.5 트레이스 (`lib/trace.ts`)

OpenTelemetry(ADOT)가 AgentCore Runtime 에서 자동 계측되므로 스팬 생성 자체는 구현하지 않는다.
이 파일은 그 위에 얹는 애플리케이션 레벨 레코드 — 단계 이름, 도구 호출, 지연시간, 토큰 사용량,
비용 추정, 프롬프트 버전을 하나로 모아 `Job`/`Analysis.traceId` 로 연결한다. 트레이스 데이터는
공개 화면에 노출하지 않는다.

## 9. AWS 클라이언트 주입 (`lib/clients.ts`)

전 클라이언트(DynamoDB, S3, Transcribe, Lambda, CloudFront)를 lazy singleton + setter 로 노출한다.
그래프 노드는 AWS SDK 를 직접 import 하지 않고 이 파일을 거친다. 테스트는 `setXxxClient()` 로
스텁을 주입하고 `resetClients()` 로 되돌린다 — 루트 steering(`tech.md`)의 "AWS 호출은 주입
가능하게" 규칙을 agent 워크스페이스에서 구현한 지점.

`region()` 헬퍼는 `AWS_REGION`/`AWS_DEFAULT_REGION` 미설정 시 즉시 예외를 던진다 — 3절에서 언급한
"AgentCore 는 AWS_REGION 을 자동 주입하지 않는다" 함정과 직결된다.

## 10. 인프라 배선 (`infrastructure/lib/pipeline-stack.ts`)

```
S3 (recordings/ 업로드) → SQS → trigger-upload Lambda → AgentCore InvokeAgentRuntime (analyze_upload)
                                                              │
                                                     Transcribe 작업 시작
                                                              │
                                              EventBridge (Transcribe Job State Change)
                                                              │
                                              trigger-transcribe Lambda → AgentCore InvokeAgentRuntime (analyze_transcribed)
```

핵심 배선 규약(어긋나면 조용히 멈춘다 — `.kiro/steering/pitfalls.md` "분석 파이프라인 배선" 절
참고):
- S3 이벤트 알림 프리픽스는 `recordings/`. `audio/` 로 잘못 걸리면 이벤트가 아예 발생하지 않는다.
- EventBridge `detail-type` 은 정확히 `Transcribe Job State Change` (Transcription 아님).
- Transcribe 작업명은 `waganda-<tastingId>-<recordingId>` — 둘 다 UUID 라 `recordingId` 를 함께
  넘기지 않으면 파싱이 안 된다.
- 두 트리거 Lambda 는 `@aws-sdk/client-bedrock-agentcore` 를 esbuild 번들에 **포함**해야 한다
  (`externalModules` 에 `@aws-sdk` 전체를 넣으면 실행 시 죽는다 — Lambda 런타임에 이 패키지가
  기본 포함되지 않기 때문).

AgentCore 실행 역할(`AgentCoreExecutionRole`)의 IAM 정책은 8개 영역(Bedrock 추론, Transcribe,
미디어/세션 버킷, DynamoDB, 오디오 Lambda 호출, CloudFront 무효화, SSM+KMS, ECR pull)으로 최소
권한 구성되어 있고, 각 정책 옆에 "이게 없으면 어느 단계에서 멈추는지"가 주석으로 남아 있다
(예: `InvokeAudioLambda` 없으면 전사 이후 멈춤, `CloudWatchLogs` 없으면 디버깅 불가).

## 11. 검증되지 않은 부분 (배포 대기)

`docs/issues/spike-findings.md` 기준으로 다음은 **로컬 검증만 완료, 실배포 미확인**:

- AgentCore Runtime 배포 자체와 `/invocations`·`/ping` 실동작.
- 동일 `runtimeSessionId` 2회 호출 시 세션 지속성.
- ADOT 자동 계측으로 실제 스팬이 수집되는지.

**부분 확인 + 경고:** Transcribe 한국어 화자분리는 실제 녹음 1건에서 실패(2명 중 1명으로 판정)했다.
파이프라인 자체는 설계대로 동작(`mappingConfidence: 'none'`, 억지 매핑 안 함, 화자 비의존 서술
생성)했지만, 화자 기반 기능(반응 일치도, 화자 대비 코멘트, discovery 의 화자 축)이 실제로 성립
하는지는 두 사람이 충분히 번갈아 말하는 녹음으로 재측정이 필요하다. `pitfalls.md` 에 기록된
"F0 gap 임계값을 낮출 근거는 없다"는 이후 실측(두 화자 F0 gap 이 임계값을 크게 웃돎)에서
나온 결론이다.

## 12. 검토된 대안과 기각 이유 (요약)

| 대안 | 판단 | 이유 |
|---|---|---|
| Strands `Graph`/`GraphBuilder` 로 파이프라인 구성 | 기각 | SDK 에 없거나(GraphBuilder) 노드=에이전트 전제가 강해(Graph) 순수 로직 노드에 부적합 |
| Bedrock 관리형 에이전트 오케스트레이션 | 기각 | 단계가 고정 워크플로, 모델이 순서를 고를 지점이 없음 |
| AgentCore 장기 메모리로 취향 프로파일 대체 | 기각 | 이미 결정론적 계산이 근거 추적·재현성·비용에서 우월 |
| Claude/Nova 로 오디오 직접 전사 | 기각 | Bedrock 모델 중 오디오 입력을 받는 텍스트 생성 모델이 없음(검증됨) |
| 라벨 인식에 `webSearch` 를 자율 도구로 제공 | 기각 | 실패 상황에서도 모델이 검색을 호출, 무료 티어 낭비 |
| AgentCore 단기 세션(대화형) | 조건부 보류 | 다중 턴이 필요한 기능(`/pick` 등)이 아직 없음. 코드는 이미 구성됨 |
