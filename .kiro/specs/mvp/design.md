# Design Document: 와간다 (Waganda)

> 대상 요구사항: `.kiro/specs/mvp/requirements.md` (Requirement 1~14)
> 이 문서는 Phase 1 (R1~R11)을 구현 가능한 수준으로 설계한다. Phase 2 (R12~R14)는 확장 지점만 명시한다.

---

## Overview

### 설계 목표

| 목표 | 근거 요구사항 |
| --- | --- |
| 유휴 시 과금되는 리소스를 하나도 두지 않는다 | R11 |
| 공개 열람은 로그인 없이, 쓰기는 지정 Google 계정만 | R1 |
| 판단이 필요한 곳에만 에이전트를 쓰고, 나머지는 결정론적으로 처리 | R5, R6 |
| 에이전트가 폭주해도 요금 사고가 나지 않는다 | R10 |
| 데이터 규모(수백 건)에 맞는 가장 단순한 구조를 택한다 | 전반 |

### 핵심 설계 원칙

1. **결정론 우선.** 항상 실행되어야 하는 단계는 고정 노드로 두고 모델을 호출하지 않는다. 에이전트는 "무엇을 조회할지", "지금 실행할 필요가 있는지" 같은 판단에만 쓴다.

2. **재개는 DB 상태로 결정한다.** 프레임워크의 세션 지속성은 편의 기능으로만 쓰고, 파이프라인 정합성은 DynamoDB에 기록된 작업 상태에 의존한다. 모든 도구는 멱등이며, 그래프 진입 시 완료된 단계를 건너뛴다. 프레임워크 재개 의미론이 기대와 달라도 파이프라인이 깨지지 않는다.

3. **LLM에 노출되는 도구는 전부 읽기 전용.** 쓰기는 결정론적 노드에서만 수행한다. 에이전트가 DB를 망가뜨릴 경로를 원천 차단한다.

4. **통계는 코드가 계산한다.** 모델에게 산수를 시키지 않는다. 에이전트는 잘 정의된 계산 도구를 호출하고, 그 결과를 해석해 문장으로 만든다.

5. **전량 적재 후 메모리 연산.** 데이터가 수백 건이므로 인덱스 설계나 SQL 최적화 대신 전체를 읽어 TypeScript에서 계산한다. 이 규모에서는 이것이 편법이 아니라 정석이며, 에이전트에게 SQL을 맡기지 않게 되어 인젝션 표면도 사라진다.

6. **프레임워크 중립 계약.** 도구의 입출력 스키마와 그래프 형태를 프레임워크와 분리해 정의하고, 바인딩은 얇은 어댑터로 둔다.

---

## 기술 스택 결정

| 영역 | 선택 | 채택 근거 | 탈락 대안 |
| --- | --- | --- | --- |
| 웹 | Next.js 15 App Router → Lambda + CloudFront | 요청당 과금, 유휴 $0 | ECS Fargate + ALB (유휴 월 $30+) |
| 데이터 | DynamoDB 온디맨드 | 유휴 $0, 콜드 스타트 없음 | Aurora Serverless v2 (재기동 ~15초), Aurora DSQL (외래키 미지원) |
| 검색 | 구조적 필터 + 부분일치 | 수백 건 규모에서 벡터 검색 불필요 | pgvector |
| 에이전트 | Strands Agents (TypeScript) | 저장소 언어 통일, 조건부 엣지 + 결정론 노드, `S3SessionManager` 내장 | LangGraph Python (폴리글랏 비용) |
| 에이전트 런타임 | Bedrock AgentCore Runtime | 유휴 $0, I/O 대기 무과금, 관측성·가드레일 내장 | Lambda 직접 실행 (15분 제한, 관측성 자체 구현) |
| 모델 | Amazon Bedrock (Claude 계열) | 리전 내 온디맨드, 유휴 $0 | — |
| 트랜스크립션 | Amazon Transcribe (`ko-KR`, 화자분리) | 화자분리 기본 제공, 추가 비용 없음 | Whisper 자체 호스팅 |
| 오디오 분석 | Python Lambda 컨테이너 (ffmpeg + parselmouth) | 무거운 의존성을 에이전트 이미지에서 분리 | 에이전트 컨테이너 내장 (2GB 상한 압박) |
| 인증 | 앱 자체 Google OAuth + 허용 목록 + JWT 쿠키 | 편집자 2명에 Cognito는 과함, 유휴 $0 | Cognito Hosted UI |
| IaC | AWS CDK (TypeScript) | 저장소 언어 통일 | — |
| 계정 | 조직 내 전용 계정 + SCP | 폭발 반경 격리, 관리 계정에 워크로드 금지 | 관리 계정 배포 |

### 검증된 런타임 제약

AgentCore Runtime의 다음 제약을 설계 전제로 삼는다 (공식 문서 + Service Quotas API 확인).

| 제약 | 값 | 설계 영향 |
| --- | --- | --- |
| 동기 요청 타임아웃 | 15분 | 세션 A/B 각각 이 안에서 끝난다 |
| 비동기 작업 최대 | 8시간 | 사용하지 않음 (세션을 끊는 방식 채택) |
| 세션 최대 수명 | 8시간 | `maxLifetime`을 명시적으로 낮춘다 |
| 세션 유휴 종료 | 15분 (기본) | `idleRuntimeSessionTimeout`을 낮춘다 (메모리 과금 억제) |
| 최대 페이로드 | 100 MB | 오디오 원본은 S3 참조로만 전달 |
| 컨테이너 이미지 | 2 GB | 오디오 의존성 분리의 직접적 이유 |
| 플랫폼 | `linux/arm64` 필수 | CI에 ARM 빌드 필요 |
| 세션 ID | 최소 33자 | ID 생성 규칙에 반영 |
| 하드웨어 | 세션당 최대 2 vCPU / 8 GB | 충분 |

과금은 CPU 실제 소비분 + 세션 수명 동안의 피크 메모리(초당)다. **I/O 대기 중 CPU 과금이 없다.** 모델 응답 대기가 많은 워크로드에 유리하며, 반대로 세션을 살려둔 채 대기하면 메모리가 계속 과금되므로 대기 구간에서는 세션을 종료한다.

---

## Architecture

### 전체 구성

```
                          waganda.yanbert.com
                                  │
                    ┌─────────────▼─────────────┐
                    │       CloudFront          │  ACM 인증서 (waganda 계정에서 신규 발급)
                    │  (공개 페이지 장기 캐시)   │
                    └──┬────────┬───────────┬───┘
          /_next/static │        │ /media/* │ 그 외
                        ▼        ▼          ▼
                   ┌────────┐ ┌──────┐  ┌──────────────────────┐
                   │ S3     │ │ S3   │  │ Lambda (Next.js)     │
                   │ static │ │ media│  │ ARM64 컨테이너        │
                   └────────┘ └──────┘  │ Function URL + OAC   │
                     (OAC, 직접 접근 차단) └───┬──────────────┬───┘
                                              │              │
                                     ┌────────▼───────┐  ┌───▼──────────────┐
                                     │   DynamoDB     │  │ AgentCore Runtime│
                                     │  (온디맨드)     │  │ 라벨 인식 에이전트 │
                                     └────────────────┘  └──────────────────┘
                                              ▲                  (동기 호출)
                                              │
   ┌──────────────────────────────────────────┴──────────────────────────────┐
   │                          시음 분석 파이프라인                              │
   │                                                                          │
   │  S3 업로드 ──▶ SQS ──▶ Lambda(트리거) ──▶ AgentCore Runtime [세션 A]      │
   │                          │                   ├ ensure_job                │
   │                        DLQ                   ├ start_transcription       │
   │                                              ├ extract_acoustic ─┐       │
   │                                              └ END (세션 종료)     │       │
   │                                                                  ▼       │
   │                                                        Lambda (Python)   │
   │                                                        ffmpeg+parselmouth│
   │                                                                          │
   │  Transcribe 완료 ──▶ EventBridge ──▶ Lambda(트리거) ──▶ [세션 B]           │
   │                                              ├ load_state (완료단계 스킵) │
   │                                              ├ map_speakers              │
   │                                              ├ sommelier_analysis ◀ ReAct │
   │                                              ├ (조건부) taste_profile     │
   │                                              ├ (조건부) discovery         │
   │                                              └ persist + CDN 무효화       │
   └──────────────────────────────────────────────────────────────────────────┘
```

상시 실행되는 컴퓨팅이 없다. ALB·NAT 게이트웨이·상시 컨테이너·프로비저닝 DB가 모두 부재하며, 이는 R11의 명시적 요구다.

### 저장소 구조

```
waganda/
├── app/                          Next.js App Router
│   ├── (public)/                 공개 페이지 (CDN 캐시 대상)
│   │   ├── page.tsx              대시보드
│   │   ├── tastings/[id]/        시음 상세
│   │   ├── wines/                와인 목록·상세
│   │   ├── explore/              지역 계층 탐색
│   │   ├── timeline/
│   │   └── discoveries/          발견 카드
│   ├── record/                   시음 기록 작성 (쓰기)
│   └── api/
│       ├── auth/google/{start,callback}/
│       ├── auth/logout/
│       ├── tastings/             쓰기 API
│       ├── wines/
│       └── labels/analyze/       라벨 인식 에이전트 호출
├── components/
├── lib/
│   ├── auth/                     OAuth, 세션 검증, 허용 목록
│   ├── db/                       DynamoDB 리포지토리
│   ├── domain/                   순수 함수 (통계, 취향, 패턴, 화자매핑)
│   ├── agent/                    AgentCore 호출 클라이언트
│   └── cache/                    CloudFront 무효화
├── packages/schemas/             app ↔ agent 공유 Zod 스키마
├── agent/                        Strands 에이전트 (TS)
│   ├── src/entrypoint.ts         /invocations, /ping
│   ├── src/graph/                그래프 정의 + 노드
│   ├── src/agents/               소믈리에·취향·발견·라벨
│   ├── src/tools/                도구 구현 (읽기 전용)
│   └── Dockerfile                ARM64
├── audio/                        Python Lambda 컨테이너
│   ├── handler.py
│   └── Dockerfile                ARM64
├── infrastructure/               CDK
└── __tests__/
```

`packages/schemas`가 앱과 에이전트의 단일 스키마 원본이다. Strands TypeScript를 택한 주된 실익이 여기서 나온다 — 분석 결과 스키마를 두 언어로 중복 정의하지 않는다.

---

## 데이터 모델

### 설계 방침

단일 테이블 + GSI 1개. 개별 엔티티는 PK/SK로 직접 접근하고, 분석·집계·계층 탐색은 **전량 Scan 후 메모리 연산**으로 처리한다. 수백 건 규모에서 Scan 1회는 수십 ms이며, 임의 축을 조합하는 R8 패턴 탐색을 인덱스 설계 없이 자유롭게 수행할 수 있다.

### 키 구조

테이블 `waganda-<env>`, PK `pk`, SK `sk`. GSI1 (`gsi1pk`, `gsi1sk`).

| 엔티티 | pk | sk | gsi1pk | gsi1sk |
| --- | --- | --- | --- | --- |
| 와인 | `WINE#<id>` | `META` | `TYPE#WINE` | `<정규화된 이름>` |
| 와이너리 | `WINERY#<id>` | `META` | `TYPE#WINERY` | `<정규화된 이름>` |
| 지역 | `REGION#<id>` | `META` | `TYPE#REGION` | `<경로 문자열>` |
| 시음 세션 | `TASTING#<id>` | `META` | `TYPE#TASTING` | `<tastedAt ISO>#<id>` |
| 녹음 | `TASTING#<id>` | `REC#<recId>` | — | — |
| 분석 결과 | `TASTING#<id>` | `ANALYSIS` | — | — |
| 분석 작업 | `TASTING#<id>` | `JOB` | `TYPE#JOB#<status>` | `<updatedAt>` |
| 취향 프로파일 | `PROFILE` | `CURRENT` | — | — |
| 발견 카드 | `DISCOVERY#<id>` | `META` | `TYPE#DISCOVERY` | `<createdAt>#<id>` |
| 속도 제한 카운터 | `RATE#<ipHash>` | `<윈도우>` | — | — (TTL) |

시음 세션의 녹음·분석·작업이 같은 파티션에 모이므로 상세 화면은 `Query(pk = TASTING#<id>)` 한 번으로 전부 읽는다.

### 접근 패턴 매핑

| 패턴 | 구현 | 근거 요구사항 |
| --- | --- | --- |
| 시음 상세 (녹음·트랜스크립트·분석) | `Query(pk)` | R9 |
| 타임라인 최신순 | `Query(GSI1, TYPE#TASTING, desc)` | R9 |
| 특정 와인의 시음 이력 | 전량 캐시에서 필터 | R9 |
| 와인 검색 (이름·와이너리·지역·품종 부분일치) | 전량 + 정규화 부분일치 | R4 |
| 지역 계층 트리 | 전량 + 메모리 트리 구성 | R4, R9 |
| 평점 랭킹 | 전량 + 정렬 | R9 |
| 취향 통계 / 패턴 탐색 | 전량 + 순수 함수 | R7, R8 |
| 진행 중 작업 | `Query(GSI1, TYPE#JOB#<status>)` | R5 |

### 스키마 정의와 버전

관계형 DB가 강제해주던 것을 앱에서 대체한다 (R4, R11).

- 모든 레코드에 `schemaVersion: number`를 저장한다. 리더는 하위 버전을 읽어 최신 형태로 승격(upcast)한다.
- 읽기·쓰기 경계에서 Zod로 검증한다. 파싱 실패는 로그와 함께 격리하고 전체 조회를 실패시키지 않는다.
- 참조 무결성(`wine.wineryId`, `wine.regionId`, `tasting.wineId`, `region.parentId`)은 쓰기 시 대상 존재를 확인한다.
- 삭제 시 역참조를 확인한다. 시음 기록이 있는 와인 삭제는 거부하고 연결 건수를 반환한다.
- 갱신은 `ConditionExpression`으로 `updatedAt`(또는 `rev`)을 대조하는 낙관적 동시성을 적용한다. 충돌 시 409를 반환하고 클라이언트가 최신 값을 다시 읽게 한다.

### 주요 엔티티 필드

```ts
// packages/schemas/tasting.ts (요약)
Tasting = {
  id, wineId, tastedAt,
  labelImageKey?, priceKrw?, priceBand?,   // priceBand: 패턴 탐색 축
  manualRating?,                            // 1~5, 0.5 단위
  schemaVersion, createdAt, updatedAt, rev,
}

Recording = {
  id, tastingId, audioKey, durationSec, format,
  transcriptKey?,                          // Transcribe 출력 S3 키
  acoustic?: {
    rmsCurve: number[], f0Track: {t:number,hz:number}[],
    silences: {start:number,end:number}[],
    speechRate: number,
    laughterCandidates: {start:number,end:number}[],  // 휴리스틱
  },
  speakers?: {
    segments: {speaker:'speaker_1'|'speaker_2', start:number, end:number}[],
    mapping: { speaker_1: Persona, speaker_2: Persona } | null,
    mappingConfidence: 'high'|'medium'|'none',
  },
}
// Persona = 'yan' | 'robert'

Analysis = {
  tastingId,
  summary, highlights: {quote, note, atSec?, speaker?}[],
  aiRating,                                 // 1~5, 0.5 단위
  notes: { acidity, tannin, body, aroma, finish },   // 각 1~5
  evidence: { field: string, basis: string }[],      // R6: 근거 필수
  comparisonToPast?, speakerContrast?, agreementScore?,  // 0~100
  editedSummary?, editedHighlights?,        // 사용자 수정 시 원본 보존
  promptVersion, modelId, traceId,
}

Job = {
  tastingId, status: 'queued'|'transcribing'|'analyzing'|'completed'|'failed',
  completedSteps: string[],                 // 멱등 재개의 근거
  transcribeJobName?, attempts, lastError?, updatedAt,
}
```

`priceBand`, `labelTags`, `bottleShape`, `closure`, 시음 시각의 요일·시간대는 R8 패턴 발견의 **비전통 탐색 축**으로 쓰인다. 라벨 인식 단계에서 미리 채워 넣는 것이 목적이다.

---

## 에이전트 설계

### 에이전트 구성

| 에이전트 | 호출 방식 | 역할 | 요구사항 |
| --- | --- | --- | --- |
| 라벨 인식 | 앱에서 동기 호출 | 라벨 사진 → 와인 필드 + 시각·물리 태그 | R3 |
| 분석 오케스트레이터 | 큐/이벤트 트리거 | 파이프라인 그래프 실행 | R5 |
| 소믈리에 | 오케스트레이터의 서브에이전트 | 요약·하이라이트·평점·5축 노트 | R6 |
| 취향 프로파일 | 조건부 서브에이전트 | 선호/비선호 패턴, 추천 | R7 |
| 패턴 발견 | 조건부 서브에이전트 | 뜻밖의 상관 패턴 → 발견 카드 | R8 |
| 대화형 소믈리에 | Phase 2 | 자연어 질의응답 | R12 |

### 파이프라인 그래프

Strands `GraphBuilder`로 구성한다. 고정 노드는 모델을 호출하지 않는 순수 코드이며, 조건부 엣지는 `EdgeHandler`로 표현한다.

**세션 A — 업로드 직후 (SQS 트리거)**

| 노드 | 종류 | 동작 |
| --- | --- | --- |
| `ensure_job` | 고정 | 작업 레코드 생성/조회 (멱등). 이미 `analyzing` 이상이면 즉시 종료 |
| `start_transcription` | 고정 | Transcribe 작업 시작 (`ko-KR`, 화자분리 최대 2명). 작업명은 `tastingId` 기반으로 결정론적 생성 → 재시도 시 중복 생성 방지 |
| `extract_acoustic` | 고정 | 오디오 Lambda 호출 → 음향 특징 저장. 이미 있으면 건너뜀 |

세션 A는 여기서 종료한다. 트랜스크립션 완료를 기다리며 세션을 유지하지 않는다 (메모리 과금).

**세션 B — Transcribe 완료 (EventBridge 트리거)**

| 노드 | 종류 | 동작 |
| --- | --- | --- |
| `load_state` | 고정 | 작업 상태·트랜스크립트·음향 특징 적재. `completedSteps`로 이후 분기 |
| `map_speakers` | 고정 | 화자별 평균 F0 비교 → 실명 매핑 |
| `enrich_wine_meta` | **조건부** | 와인 메타데이터에 저신뢰 필드가 있을 때만 라벨 에이전트 재호출 |
| `sommelier_analysis` | **에이전트(ReAct)** | 도구를 자율 선택해 분석 생성 |
| `refresh_taste_profile` | **조건부 에이전트** | 완료 시음 수가 5의 배수일 때만 |
| `run_discovery` | **조건부 에이전트** | 완료 시음 10건 이상이고 마지막 실행 이후 5건 이상 늘었을 때만 |
| `persist_and_publish` | 고정 | 결과 저장, 작업 완료 처리, CDN 무효화 |

조건부 분기 조건은 모두 데이터에서 계산되는 결정론적 술어다. "지금 취향 프로파일을 갱신할지"를 모델에게 묻지 않는다.

### 재개 전략

세션 A와 B는 **독립적으로 멱등한 두 번의 호출**이다. 정합성은 DynamoDB의 `Job.completedSteps`가 보장하고, `S3SessionManager`의 세션 지속성은 대화 맥락 유지 용도로만 쓴다. 프레임워크의 재개 의미론이 기대와 다르더라도 파이프라인은 올바르게 동작한다.

세션 ID는 두 호출에서 동일해야 하며 최소 33자 제약을 만족해야 한다.

```
runtimeSessionId = `waganda-tasting-${tastingId}-${env}`   // 33자 이상 보장, 길이 검증 필수
```

### 도구 계약

프레임워크 중립으로 정의한다. `packages/schemas/tools.ts`에 Zod로 선언하고, Strands 바인딩은 `agent/src/tools/index.ts`의 얇은 어댑터가 담당한다.

**LLM에 노출되는 도구는 모두 읽기 전용이다.**

| 도구 | 입력 | 출력 | 사용 에이전트 |
| --- | --- | --- | --- |
| `getWine` | `wineId` | 와인 + 와이너리 + 지역 경로 | 소믈리에, 라벨, 대화형 |
| `findWines` | `{name?, winery?, region?, grape?}` | 와인 요약 목록 (최대 20) | 라벨, 대화형 |
| `getTastingsForWine` | `wineId` | 시음 요약 목록 (시간순) | 소믈리에 |
| `getRecentTastings` | `limit ≤ 20` | 시음 요약 목록 | 소믈리에 |
| `findSimilarTastings` | `{grape?, regionId?, axes?, limit ≤ 10}` | 유사 시음 목록 + 유사 근거 | 소믈리에 |
| `getTasteProfile` | — | 프로파일 또는 비활성 상태 | 소믈리에, 취향, 발견 |
| `listDiscoveries` | `{includeHidden: false}` | 발견 카드 목록 | 발견, 대화형 |
| `computeStats` | 아래 스펙 | 그룹별 통계 | 취향, 발견 |
| `webSearch` | `query` | 검색 결과 요약 + 출처 URL | 라벨 |

`computeStats`는 임의 코드나 SQL이 아니라 **제한된 스펙**을 받는다. 이것이 R7·R8의 "실행 가능한 계산 도구" 요구를 충족하면서 R10의 질의 안전성을 동시에 만족시키는 방식이다.

```ts
ComputeStatsSpec = {
  groupBy: 'grape' | 'country' | 'region' | 'priceBand' | 'vintageDecade'
         | 'labelTag' | 'bottleShape' | 'closure'
         | 'weekday' | 'hourBucket' | 'daysSincePrevTasting'
         | 'hadLaughter' | 'speakerAgreementBand',
  metric: 'meanRating' | 'ratioAtOrAbove4' | 'meanNoteAxis',
  noteAxis?: 'acidity'|'tannin'|'body'|'aroma'|'finish',
  minSampleSize: number,   // 기본 4
}
// 출력: { groups: [{ key, n, value, deltaVsOverall }], overall, totalN }
```

`groupBy`의 앞 5개가 정통 축, 뒤 7개가 비전통 축이다. R8이 요구하는 "뜻밖의 발견"은 후자에서 나온다.

### 화자 매핑 (R5)

절대 주파수 임계값은 개인차와 녹음 환경에 취약하므로, **같은 녹음 안 두 화자의 상대 비교**만 사용한다. 화자가 항상 부부 2인으로 고정되어 있어 상대 비교로 충분하다.

```
1. Transcribe 화자분리로 speaker_1 / speaker_2 시간 구간 확보
2. 오디오 Lambda가 만든 F0 트랙을 각 구간으로 슬라이스 → 화자별 중앙값 F0
   (오디오 Lambda를 재호출하지 않는다 — 트랙은 세션 A에서 이미 계산됨)
3. gap = |median(F0_a) − median(F0_b)|
     gap ≥ 60 Hz  → 낮은 쪽 yan, 높은 쪽 robert,  confidence = high
     30 ≤ gap < 60 → 동일 매핑,                    confidence = medium
     gap < 30 Hz  → 매핑 없음(null),               confidence = none
4. confidence = none 이면 소믈리에는 실명 없이 중립 표현으로 서술
5. 편집자는 상세 화면에서 두 화자 매핑을 서로 교체할 수 있다 (오판 정정)
```

발화가 심하게 겹쳐 화자분리 자체가 실패하면 단일 화자로 처리하고, 화자 구분에 의존하는 서술을 생성하지 않는다.

### 반응 일치도 (R6, R7)

두 화자가 구분된 경우에만 산출한다. 개인별 취향 벡터가 없어도 계산되도록 **세션 내 상대 지표**로 정의한다.

```
agreementScore = 100 − (
    |화자A 감정강도 − 화자B 감정강도| × w1
  + |화자A 평가방향 − 화자B 평가방향| × w2
) 를 0~100으로 정규화
```

감정 강도와 평가 방향은 소믈리에 에이전트가 화자별로 산출한 값을 쓴다. 월 단위로 집계해 추이를 보여준다.

### 발견 카드 판정 (R8)

여러 축을 동시에 탐색하면 우연한 상관이 반드시 나온다. 이를 감안한 등급 기준을 코드로 고정한다.

| 조건 | 판정 |
| --- | --- |
| `n < 4` | 제시하지 않음 |
| `|deltaVsOverall| < 0.5` | 제시하지 않음 |
| `n ≥ 6` and `|delta| ≥ 1.0` | 뚜렷함 |
| `n ≥ 5` and `|delta| ≥ 0.7` | 보통 |
| 그 외 | 약함 |

모든 카드에 우연 가능성 문구를 함께 표시한다. 이미 제시한 패턴은 `(groupBy, key)` 조합으로 중복을 차단하고, 표본이 늘어난 경우에만 갱신 알림을 띄운다. 편집자가 숨긴 카드는 재제시하지 않는다.

시음 10건 미만이면 발견 에이전트를 실행하지 않는다 (헛발질과 토큰 낭비 방지).

### 출력 스키마 검증

소믈리에 에이전트 출력은 Zod로 검증하고, 위반 시 최대 2회 재생성한다 (R6). 2회 후에도 실패하면 작업을 `failed`로 두고 원본 오디오·트랜스크립트를 보존한 채 재분석 버튼을 제공한다.

---

## 오디오 처리 파이프라인

### 트랜스크립션

- `LanguageCode: ko-KR` 고정, `ShowSpeakerLabels: true`, `MaxSpeakerLabels: 2`
- 다국어 자동 식별은 쓰지 않는다. 한국어 고정이 화자분리와 안정적으로 병행되고, 실제 발화가 한국어 위주에 영어 와인 용어가 섞이는 형태이기 때문이다
- 작업명은 `tastingId` + 녹음 ID 기반 결정론적 문자열 → 재시도 시 중복 생성 방지
- 출력은 미디어 버킷의 `transcripts/` 프리픽스에 저장

### 음향 특징 추출 (Python Lambda)

`ffmpeg`로 16 kHz 모노 WAV로 정규화한 뒤 다음을 산출한다.

| 특징 | 방법 | 용도 |
| --- | --- | --- |
| RMS 에너지 곡선 | numpy 프레임 단위 | 감정 강도 |
| F0 트랙 | praat-parselmouth | 화자 매핑, 톤 |
| 침묵 구간 (0.8초 이상) | RMS 임계 | "3초간 음미" 같은 해석 |
| 발화 속도 | 트랜스크립트 단어 수 / 유성 구간 | 흥분도 |
| 웃음 후보 구간 | 에너지 진동 + 유성 버스트 휴리스틱 | 재미 요소 |

웃음 감지는 전용 모델이 아닌 휴리스틱이다. 평점 산출의 결정적 근거로 쓰지 않고 서술 재미 요소와 R8 탐색 축(`hadLaughter`)으로만 활용한다. 감정 분석 전반이 "재미있는 해석" 수준이라는 전제를 유지한다.

parselmouth와 numpy/scipy는 용량이 커서 이 Lambda를 컨테이너 이미지(ARM64)로 배포하고, 에이전트 컨테이너와 분리한다. AgentCore의 2 GB 이미지 상한을 피하기 위한 결정이다.

---

## API 계약

### 공개 읽기

CloudFront에서 캐시되며 인증이 필요 없다. 서버 컴포넌트에서 직접 데이터를 읽고 렌더링한다.

| 경로 | 설명 |
| --- | --- |
| `GET /` | 대시보드 (최근 시음, 취향 카드, 최근 반응 일치도, 최신 발견 카드, 진행 중 분석) |
| `GET /tastings/[id]` | 시음 상세 |
| `GET /wines`, `/wines/[id]` | 와인 목록·상세 |
| `GET /explore/[...path]` | 지역 계층 탐색 |
| `GET /timeline`, `/rankings`, `/discoveries` | 각 뷰 |

### 쓰기 (편집자 세션 필요)

| 메서드·경로 | 요청 | 응답 | 인증 실패 |
| --- | --- | --- | --- |
| `POST /api/tastings` | 와인 정보 + 시음 일시 | `{tastingId}` | 401 |
| `POST /api/tastings/[id]/recordings` | 업로드 사전 서명 요청 | `{uploadUrl, recordingId}` | 401 |
| `POST /api/tastings/[id]/analyze` | — | `{jobStatus}` | 401 |
| `PATCH /api/tastings/[id]` | 수동 평점, 요약·하이라이트 수정 | 갱신 결과 | 401 |
| `PATCH /api/recordings/[id]/speakers` | 화자 매핑 교체 | 갱신 결과 | 401 |
| `DELETE /api/tastings/[id]` | — | — | 401 |
| `POST /api/wines`, `PATCH`, `DELETE` | 카탈로그 변경 | — | 401 |
| `POST /api/labels/analyze` | 라벨 이미지 키 | 추출 필드 + 신뢰도 | 401 |
| `PATCH /api/discoveries/[id]/hide` | — | — | 401 |

모델 호출을 유발하는 `POST /api/labels/analyze`와 `POST /api/tastings/[id]/analyze`는 반드시 편집자 세션을 요구한다 (R1, R10). 공개 서비스에서 이 두 엔드포인트가 열려 있으면 임의의 방문자가 Bedrock·Transcribe 비용을 발생시킬 수 있다.

미인증 쓰기 요청의 401 응답 본문은 클라이언트가 로그인 흐름으로 전환할 수 있도록 로그인 URL을 포함한다.

```json
{ "error": "UNAUTHORIZED", "loginUrl": "/api/auth/google/start?returnTo=%2Frecord" }
```

---

## 인증 설계

계정·회원가입 없이, **쓰기 액션을 시도한 시점에만** 인증을 요구한다 (R1). 별도의 편집 모드 진입 단계를 두지 않는다.

### 흐름

```
1. 방문자가 편집·삭제 컨트롤을 누른다 (컨트롤은 세션 유무와 무관하게 렌더링됨)
2. 쓰기 API가 401 + loginUrl 반환
3. 클라이언트가 입력 중인 폼 초안을 sessionStorage에 보존
4. /api/auth/google/start?returnTo=<현재경로>
     - state 난수 생성 → HttpOnly 쿠키에 저장, returnTo 동봉
     - Google 인증 화면으로 리다이렉트
5. /api/auth/google/callback
     - state 쿠키와 쿼리 state 대조 (CSRF 방어)
     - code → access_token → userinfo
     - verified_email 확인
     - 허용 목록 확인 → 미포함이면 세션 미발급 + 시도 기록
     - JWT(jose HS256) 서명 → HttpOnly·Secure·SameSite=Lax 쿠키
     - returnTo로 리다이렉트
6. 클라이언트가 폼 초안 복원, 사용자가 액션 재실행
```

### 세션

```ts
// lib/auth/session.ts
EditorSession = { email: string, iat: number, exp: number }

getEditorSession(): Promise<EditorSession | null>
requireEditor(): Promise<EditorSession>          // 없으면 throw
isAllowedEmail(email): boolean                   // 대소문자 무시, trim
```

- 서버 사이드 confidential client(클라이언트 시크릿 보유)이므로 `state` 대조로 충분하며 PKCE는 적용하지 않는다
- **매 요청마다 JWT의 이메일이 허용 목록에 여전히 있는지 재검증한다.** 서명이 유효해도 목록에서 빠졌으면 무효로 처리한다. 서버 측 세션 저장소 없이 권한을 즉시 회수하는 수단이다
- 로그아웃은 쿠키 삭제로 처리한다 (stateless JWT이므로 서버 세션이 없다)
- 편집자를 개별 식별하지 않는다. 허용 목록의 모든 계정은 동일 권한이며, 기록의 작성자로 귀속시키지 않는다
- 시음자 정보는 저장하지 않는다. 화자는 음성에서 자동 추정한다

### CSRF와 남용 방지

- `SameSite=Lax` + 쓰기 요청의 `Origin` 헤더 동일 출처 검증
- 속도 제한은 WAF(월 $5+) 대신 애플리케이션 계층에서 DynamoDB 조건부 증가 + TTL 카운터로 구현한다. 공개 페이지는 대부분 CDN에서 처리되므로 실질 대상은 API 경로다
- 인증·쓰기 경로는 `robots.txt`에서 크롤링 제외

---

## 캐시 및 무효화 전략

방문자 트래픽이 오리진과 DynamoDB에 도달하지 않게 하는 것이 목표다 (R11).

| 경로 | 캐시 정책 |
| --- | --- |
| `/_next/static/*` | 1년, immutable |
| `/media/*` | 장기 캐시, OAC로 S3 직접 접근 차단 |
| 공개 페이지 | 장기 캐시, 쓰기 시 무효화 |
| `/api/*`, `/record` | 캐시 안 함 |

쓰기가 성공하면 `persist_and_publish` 노드 또는 쓰기 API가 CloudFront 무효화를 발행한다. 경로는 `/*` 단일 패턴을 쓴다 — 무효화는 월 1,000 경로까지 무료이고 우리 쓰기 빈도가 월 수십 회이므로 정밀한 경로 계산보다 단순함이 낫다.

시음 기록은 한 번 쓰면 거의 바뀌지 않는 데이터라 이 패턴이 잘 맞는다.

---

## 가드레일 및 관측성

### 상한값

서비스 기본값에 의존하지 않고 모두 명시한다 (R10). 기본값(`maxIterations` 75, `timeoutSeconds` 3600, `maxLifetime` 28800초, 유휴 900초)은 취미 프로젝트에 과도하게 관대하다.

| 항목 | 설정값 | 근거 |
| --- | --- | --- |
| `maxIterations` | 12 | 소믈리에 분석에 도구 호출 4~6회로 충분 |
| `maxTokens` | 호출당 예산 지정 | 요금 폭주 차단 |
| `timeoutSeconds` | 300 | 분석 1건 목표 시간의 여유분 |
| `idleRuntimeSessionTimeout` | 60 | 세션 수명 동안 메모리가 과금되므로 최소화 |
| `maxLifetime` | 900 | 세션이 길게 살 이유가 없다 |
| 일간 에이전트 실행 횟수 | 상한 설정, 초과 시 익일까지 차단 | R10 |
| 월 모델 비용 | 예산의 80%·100% 알림, 100%에서 신규 실행 차단 | R10 |

### 트레이스

- OpenTelemetry로 수집한다. AgentCore Runtime은 ADOT가 적용되어 있어 계측 라이브러리를 의존성에 추가하는 것만으로 스팬이 수집된다 — 별도 계측 코드가 필요 없다
- 오케스트레이터와 서브에이전트를 상하위 관계가 드러나는 계층으로 기록한다
- 도구 호출, 입출력 요약, 지연시간, 토큰 사용량, 비용 추정, 사용된 프롬프트 버전을 남긴다
- 프롬프트와 도구 정의는 코드로 버전 관리하고 각 트레이스에 버전을 기록한다
- 트레이스와 운영 지표는 공개 화면에 노출하지 않는다

### 프롬프트 인젝션 완화

트랜스크립트와 라벨 이미지는 신뢰할 수 없는 입력이다. 시스템 지시와 사용자 데이터를 구분된 채널로 전달하고, 사용자 데이터 안의 지시문을 따르지 않도록 시스템 프롬프트에 명시한다. LLM 노출 도구가 전부 읽기 전용이므로 인젝션이 성공해도 데이터 변조·삭제는 불가능하다.

---

## 인프라 (CDK)

`AWS::BedrockAgentCore::Runtime`, `::RuntimeEndpoint`, `::Memory`가 CloudFormation 정식 리소스로 제공되므로 커스텀 리소스 없이 정의한다.

| 스택 | 리소스 |
| --- | --- |
| `WagandaDataStack` | DynamoDB 테이블(온디맨드, PITR), 미디어 S3(버전관리), 에이전트 세션 S3, SSM 파라미터 |
| `WagandaPipelineStack` | ECR 리포지토리, AgentCore Runtime + Endpoint, SQS + DLQ, 트리거 Lambda 2개, EventBridge 규칙, 오디오 Lambda(컨테이너), IAM 역할 |
| `WagandaWebStack` | Next.js Lambda(컨테이너), Function URL, CloudFront, 정적 자산 S3, Route53 레코드, 인증서 조회 |
| `WagandaOpsStack` | 로그 그룹(14일), AWS Budgets, 알람, SNS 토픽 |

### 계정 구조

조직(`o-adrj748fmf`)에 전용 계정을 추가하고 그 안에만 배포한다. 관리 계정에는 워크로드를 두지 않는다.

```
o-adrj748fmf  (Organizations, FeatureSet: ALL, SCP 활성)
├── 156679781278  Yan So      관리 계정 — 워크로드 없음, yanbert.com 호스팅 존 보유
├── 929778606269  iwasthere   기존 분리 계정
└── (신규)        waganda     ← 이 프로젝트의 모든 리소스
```

전용 계정을 쓰는 주된 이유는 비용이 아니라 **폭발 반경**이다. 이 서비스는 로그인 없이 접근 가능한 공개 엔드포인트를 노출하고 자율적으로 도구를 호출하는 에이전트를 실행한다. 관리 계정은 계정 생성·SCP 부착·결제 접근 권한을 가지므로 이런 워크로드를 두기에 가장 부적합하다.

부수 효과로 계정 단위 비용 격리, 서비스 쿼터 격리(Bedrock TPM, Lambda 동시성, AgentCore 세션), 프로젝트 종료 시 계정 폐쇄로 완결되는 정리가 따라온다.

**주의:** 통합 결제 하에서 무료 등급은 결제 계정 기준으로 합산된다. 계정을 분리해도 무료 등급이 늘어나지 않는다. 비용 이득을 기대할 부분이 아니다.

### SCP (하드 가드레일)

R10의 상한값은 애플리케이션이 스스로 지키는 소프트 가드레일이다. SCP는 코드 실수와 무관하게 강제되는 별도 방어선이며, 자율 에이전트를 운영하는 계정에서 특히 의미가 있다.

- 선택한 단일 리전(+ CloudFront·IAM·Route53 등 글로벌 서비스 예외) 외 리전에서의 리소스 생성 거부
- 이 프로젝트가 쓰지 않는 고비용 서비스 거부 — EC2, RDS, EKS, SageMaker, Redshift, NAT 게이트웨이
- 조직 관리 API 거부

리전은 **AgentCore Runtime · 사용할 Bedrock 모델 · Transcribe `ko-KR`이 모두 제공되는 리전**이어야 한다. 계정 준비 단계에서 확인해 확정한다 (작업 0).

### 도메인

계정이 분리되므로 관리 계정의 `*.yanbert.com` 인증서를 재사용할 수 없다. 서브도메인 위임 방식을 택한다.

```
관리 계정 (156679781278)
└── 호스팅 존 yanbert.com  (Z07510733MORPFMY88JZA)
    └── NS 레코드: waganda.yanbert.com → 자식 계정 존의 네임서버   [1회 수동 등록]

waganda 계정
└── 호스팅 존 waganda.yanbert.com                                 [+$0.50/월]
    ├── ACM 인증서 (us-east-1, DNS 검증)                           무료, 자동 검증
    └── A/AAAA 별칭 → CloudFront
```

계정 간 IAM 역할로 부모 존에 직접 레코드를 쓰는 방식($0)도 가능하지만, 위임 방식이 배포 파이프라인을 단순하게 유지하고 이후 DNS를 자식 계정에서 독립적으로 관리할 수 있어 월 $0.50의 값을 한다. 위임이 끝나면 인증서 DNS 검증도 자식 계정 안에서 자동 완료된다.

### 비용 할당 태깅

```ts
// infrastructure/bin/waganda.ts
Tags.of(app).add('Project', 'waganda');
Tags.of(app).add('Environment', env);   // dev | prod
```

CDK 앱 수준에서 부여하면 태깅 가능한 모든 하위 리소스로 전파된다. 관리 계정의 `Project` 비용 할당 태그는 이미 활성 상태이므로(2025-10-24 활성화) 조직 전체 조회에 바로 반영된다.

전용 계정을 쓰므로 **비용 격리의 1차 수단은 계정 경계**다. 태그는 조직 전체를 볼 때의 일관성과 계정 내 항목별 분해를 위해 유지한다.

**모델 추론 비용 귀속.** Bedrock 온디맨드 호출은 태깅 가능한 리소스가 없어 기본적으로는 태그로 분리되지 않는다. 이를 해결하기 위해 **애플리케이션 추론 프로파일**을 `Project: waganda` 태그와 함께 생성하고, 에이전트가 모델 ID 대신 이 프로파일 ARN을 호출한다. 그러면 토큰 비용도 태그 기준 조회에 포함된다.

이것으로도 다음은 태그로 잡히지 않으므로 R10의 자체 비용 집계가 여전히 필요하다.

| 항목 | 태그 귀속 | 대안 |
| --- | --- | --- |
| Lambda, DynamoDB, S3, SQS, CloudFront, ECR, AgentCore | 가능 | — |
| Bedrock 추론 | 추론 프로파일 경유 시 가능 | — |
| Transcribe | 작업 단위 태깅 미지원 | 트레이스에 분당 단가 × 처리 시간으로 추정 기록 |
| 관리 계정의 `yanbert.com` 호스팅 존 | 다른 계정 소유이므로 대상 아님 | 위임된 자식 존만 이 계정에서 과금 |

AWS Budgets는 `Project: waganda` 태그로 필터링해 다른 프로젝트 비용과 섞이지 않게 한다. 태그 기반 비용 데이터는 활성화 시점 이후분만 집계되므로, 과거 비교가 필요하면 배포 시점을 기준으로 삼는다.

### 환경 분리

`dev`와 `prod`를 동일 IaC로 배포한다. 리소스명에 환경 접미사를 붙이고, `dev`는 `waganda-dev.yanbert.com`을 쓴다. 시크릿은 환경별 SSM 파라미터에서 주입한다.

### 시크릿

Secrets Manager(건당 월 $0.40) 대신 **SSM Parameter Store Standard(무료)** 의 SecureString을 쓴다.

- Google OAuth 클라이언트 ID / 시크릿
- 세션 JWT 서명 키
- 편집자 허용 목록 (이메일 콤마 구분)

소스코드에 시크릿을 두지 않는다.

---

## 배포 및 CI/CD

```
push / PR
  ├─ lint (eslint)
  ├─ typecheck (tsc --noEmit)          app · agent · infrastructure
  ├─ test (vitest)                     단위 + 통합
  └─ build

main 머지
  ├─ 위 전부 통과 필수 (하나라도 실패 시 배포 중단)
  ├─ OIDC로 waganda 계정 역할 assume (장기 액세스 키 미사용)
  ├─ 컨테이너 빌드 (ARM64)
  │    ├─ web        → ECR
  │    ├─ agent      → ECR
  │    └─ audio      → ECR
  ├─ cdk deploy (dev)
  ├─ 스모크 테스트
  └─ cdk deploy (prod)
```

ARM64 빌드가 필수이므로 GitHub Actions에서 ARM 러너를 쓰거나 QEMU 크로스 빌드를 구성한다. 로컬은 Apple Silicon이라 아키텍처가 일치한다.

에이전트 컨테이너 이미지 크기를 CI에서 검사하고 AgentCore 상한(2 GB)에 근접하면 실패시킨다.

---

## 에러 처리

| 상황 | 처리 | 요구사항 |
| --- | --- | --- |
| 오디오 형식·크기 위반 | 업로드 거부, 한국어 사유 표시 | R2 |
| 업로드 중 네트워크 중단 | 브라우저에 녹음 보존, 재시도 버튼 | R2 |
| 라벨 인식 실패 | 수동 입력 폼으로 전환, 사진은 첨부 유지 | R3 |
| 트랜스크립트 무음·공백 | 실패로 처리하지 않고 침묵 자체를 해석 입력으로 사용 | R5 |
| 화자분리 실패 | 단일 화자 처리, 화자 의존 서술 생략 | R5 |
| 분석 일시 오류 | 지수 백오프 3회 (SQS 재구동) | R5 |
| 3회 후 실패 | DLQ 격리, 원본 보존, 편집자에게 재분석 버튼 | R5 |
| 출력 스키마 위반 | 최대 2회 재생성 후 실패 처리 | R6 |
| 가드레일 중단 | 부분 결과 보존, 중단 사유 트레이스 기록 | R10 |
| 월 예산 도달 | 신규 에이전트 실행 차단 + 안내 | R10 |
| 동시 편집 충돌 | 409 반환, 최신 값 재조회 유도 | R4 |
| 참조 무결성 위반 | 쓰기 거부, 연결 건수 안내 | R4 |

SQS 재시도와 DLQ가 Step Functions 없이도 R5의 재시도·격리 요구를 충족한다.

---

## 비용 모델

상시 과금 리소스가 없다. 아래는 개략치이며 실제 요금은 리전·사용량에 따라 달라지므로 [AWS Pricing Calculator](https://calculator.aws)로 확인한다.

| 항목 | 유휴 달 | 월 10건 기록 |
| --- | --- | --- |
| Route53 호스팅 존 (`waganda.yanbert.com`) | $0.50 | $0.50 |
| DynamoDB 온디맨드 | ~$0 | ~$0 |
| S3 (오디오·이미지·세션) | 센트 단위 | 센트 단위 |
| ECR 이미지 저장 | 센트 단위 | 센트 단위 |
| CloudFront | 무료 등급 내 | 무료 등급 내 |
| Lambda | 무료 등급 내 | 무료 등급 내 |
| SQS / EventBridge | 무료 등급 내 | 무료 등급 내 |
| Transcribe | $0 | ~$0.5 |
| Bedrock | $0 | ~$0.5~2 |
| AgentCore Runtime | $0 | 센트 단위 (I/O 대기 무과금) |
| **합계** | **$1 미만** | **$3~7** |

계정 분리로 호스팅 존 $0.50이 추가되지만 R11의 유휴 목표($2 이하)와 월 목표($10 이하) 모두 충족한다.

R11의 목표(월 $10 이하, 유휴 달 $2 이하)를 충족한다. AWS Budgets로 80%·100% 알림을 걸고, 100%에서 신규 에이전트 실행을 차단한다.

---

## 검증 전략

### 단위 테스트

순수 함수로 분리한 도메인 로직이 검증의 중심이다. 모델 호출 없이 결정론적으로 테스트된다.

| 대상 | 케이스 |
| --- | --- |
| 화자 매핑 | gap ≥ 60 / 30~60 / < 30 경계, 단일 화자, F0 트랙 결측 |
| `computeStats` | 각 `groupBy` 축, `minSampleSize` 미달, 빈 데이터, 단일 그룹 |
| 발견 카드 판정 | 등급 경계 4개, 중복 차단, 숨긴 카드 제외 |
| 취향 프로파일 | 5건 미달 비활성, 5의 배수 갱신 트리거, 표본 3건 미만 "참고" 표기 |
| 반응 일치도 | 두 화자 존재/부재, 정규화 경계 |
| 스키마 승격 | 이전 `schemaVersion` 레코드 읽기 |
| 참조 무결성 | 존재하지 않는 참조, 역참조 있는 삭제 |

### API 테스트

새 API마다 인증·권한·에러 케이스를 포함한다.

- 세션 없음 → 401 + `loginUrl` 포함 확인
- 허용 목록 외 이메일의 유효 JWT → 무효 처리 확인 (매 요청 재검증)
- 만료 JWT → 401
- `state` 불일치 콜백 → 세션 미발급
- `verified_email: false` → 거부
- 잘못된 `Origin` 쓰기 요청 → 거부
- 동시 갱신 충돌 → 409
- 모델 호출 엔드포인트의 미인증 접근 차단 (비용 보호 회귀 방지)

### UI 테스트

- 세션 유무와 무관하게 편집 컨트롤이 렌더링되는지
- 미인증 상태에서 쓰기 시도 → 로그인 흐름 전환 + 폼 초안 보존·복원
- 분석 진행 중 상태 표시, 완료 시 자동 갱신
- 화자 매핑 불확실 시 실명 미표시
- 취향 프로파일 비활성 시 진행률 표시
- 모바일 375px 폭 렌더링

### 통합 테스트

- Transcribe·Bedrock을 스텁으로 대체한 파이프라인 전체 실행
- 세션 A만 완료된 상태에서 세션 B 재실행 → 완료 단계 스킵 확인 (멱등성)
- 세션 B 중복 호출 → 결과 중복 생성 없음
- 스키마 위반 응답 → 재생성 2회 후 실패 처리

### 초기 스파이크 (구현 전 필수)

가장 불확실한 조합을 먼저 검증한다.

1. Strands TypeScript 에이전트를 ARM64 컨테이너로 AgentCore Runtime에 배포하고 `/invocations`·`/ping`이 동작하는지
2. `S3SessionManager`로 세션이 유지되는지, 두 번째 호출에서 상태가 복원되는지
3. Transcribe 한국어 화자분리 품질 — 실제 부부 녹음 샘플로 확인
4. ADOT 자동 계측으로 Strands 스팬이 CloudWatch에 나타나는지

---

## 위험과 완화

| 위험 | 영향 | 완화 |
| --- | --- | --- |
| Strands TS SDK가 Python보다 젊다 | 기능 공백·예제 부족 | 도구 계약을 프레임워크 중립으로 정의, 얇은 어댑터. 스파이크로 조기 확인 |
| AgentCore + Strands TS 조합 사례 부족 | 통합 이슈 | 진입점을 얇게 유지해 Lambda 직접 실행으로 후퇴 가능하게 설계 |
| Transcribe 한국어 화자분리 품질 | 실명 매핑 오판 | 신뢰도 등급 + 매핑 생략 폴백 + 편집자 수동 교체 |
| 웃음 감지 휴리스틱 부정확 | 서술 품질 저하 | 평점 근거로 쓰지 않고 재미 요소·탐색 축으로 한정 |
| 전량 Scan 전략의 성장 한계 | 성능 저하 | 리포지토리 계층으로 스토리지 교체 가능하게 유지. 임계치 초과 시 재설계 |
| 에이전트 이미지 2 GB 상한 | 배포 실패 | 오디오 의존성 분리 + CI에서 이미지 크기 검사 |
| ARM64 CI 빌드 | 파이프라인 복잡도 | ARM 러너 또는 QEMU. 로컬은 아키텍처 일치 |
| 공개 서비스 남용 | 비용 발생 | 모델 호출 엔드포인트를 편집자 전용으로 제한, 앱 계층 속도 제한, 예산 차단 |
| 패턴 발견의 다중 비교 문제 | 헛된 "발견" 남발 | 표본·효과크기 하한, 신뢰 등급, 우연 가능성 명시 |

---

## Phase 2 확장 지점

| 요구사항 | 확장 방식 |
| --- | --- |
| R12 대화형 소믈리에 | 기존 읽기 전용 도구를 재사용하는 별도 에이전트. Lambda Function URL 응답 스트리밍으로 사고 과정 노출. 세션 메모리가 실제로 필요해지면 AgentCore Memory 도입 검토 |
| R13 월간 매거진 | EventBridge 월간 스케줄 → 오케스트레이터 재사용. 이미지 카드 생성 추가 |
| R14 와인샵 스카우터 | 라벨 인식 에이전트를 다중 이미지로 확장 + 취향·발견 카드 조회 도구 조합 |
| 벡터 검색 | 누적 기록 요약이 모델 컨텍스트 한도를 넘어갈 때 재검토 (R12 명시 조건) |
