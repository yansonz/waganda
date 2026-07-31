# Implementation Plan: 와간다 (Waganda)

> 대상 문서: `.kiro/specs/mvp/requirements.md`, `.kiro/specs/mvp/design.md`
> 범위: Phase 1 (Requirement 1~11). Phase 2 (R12~R14)는 이 계획에 포함하지 않는다.

## Overview

구현 순서는 세 가지 원칙을 따른다.

1. **위험을 먼저 없앤다.** Strands TypeScript + AgentCore Runtime 조합은 검증 사례가 적다. 설계에 명시한 스파이크 4건을 기능 구현 전에 끝내고, 실패하면 이 시점에 방향을 바꾼다.
2. **아래에서 위로 쌓는다.** 공유 스키마 → 리포지토리 → 순수 도메인 로직 → 에이전트 → API → UI. 순수 함수를 먼저 만들어야 모델 호출 없이 검증되는 테스트 기반이 생긴다.
3. **인프라는 필요한 시점에 증분 배포한다.** 스파이크에 필요한 최소 스택을 먼저 만들고, 기능마다 리소스를 추가한 뒤 마지막에 관측성·예산·CI를 마감한다.

작업 **0은 선행 작업**이다. AWS 계정 생성·SCP·도메인 위임처럼 콘솔과 조직 권한이 필요한 수동 작업이며, 코드 구현 이전에 완료되어야 한다.
이후 작업 1~4가 기반, 5~9가 기록 경로, 10~13이 에이전트 파이프라인, 14~18이 열람·운영 마감이다.

---

## 진행 상태 (2026-07-29)

로컬 구현·테스트가 끝난 항목은 `[x]` 로 표시했다. 다음은 **AWS 계정·배포가 필요해 로컬에서 완료 판정할 수 없어** 미체크로 남긴다.

- 작업 0 전체 (계정·SCP·도메인 위임·부트스트랩)
- 2.1~2.5 스파이크 (실제 배포·실제 녹음 필요) — 확인된 내용은 `docs/issues/spike-findings.md` 참조
  - **2.4 는 1차 실측을 마쳤고 경고가 나왔다**: 실제 녹음 1건에서 Transcribe 가 화자를 1명으로 판정해
    화자 기반 기능(반응 일치도·화자 대비)이 성립하지 않았다. 두 사람이 번갈아 말하는 녹음으로 재측정이 필요하다.
    측정은 `npm run analyze:local -- <tastingId>` 로 배포 없이 가능하다.
- 17.2 도메인 연결 (`cdk synth` 성공). dev 환경은 만들지 않기로 결정했다.
- 18.6 실제 시음 전체 흐름 수동 검증, 18.7 배포 후 실제 비용 확인

검증 현황: 루트 vitest 429건 · agent 44건 · infrastructure 88건 · audio pytest 37건 · Playwright E2E 66건(DynamoDB Local) 전부 통과, `tsc --noEmit` 0건, `eslint` 0건, `next build` 및 `cdk synth --all` 성공.

---

## Tasks

- [ ] 0. AWS 계정 준비 (선행 작업 — 코드 구현 전 완료)
  - [ ] 0.1 대상 리전 확정 — AgentCore Runtime, 사용할 Bedrock 모델, Transcribe `ko-KR`이 **모두** 제공되는 리전을 확인해 결정. 세 가지 중 하나라도 없으면 설계 전제가 깨지므로 가장 먼저 확인한다
  - [ ] 0.2 조직(`<조직 ID>`)에 `waganda` 계정 생성. 관리 계정(`<관리 계정 ID>`)에는 워크로드를 두지 않는다
  - [ ] 0.3 SCP 작성·부착 — 확정 리전 외 리소스 생성 거부(글로벌 서비스 예외), 미사용 고비용 서비스(EC2·RDS·EKS·SageMaker·Redshift·NAT 게이트웨이) 거부, 조직 관리 API 거부
  - [ ] 0.4 계정 접근 경로 구성 — IAM Identity Center 또는 관리 계정에서의 역할 스위치. 루트 사용자 사용 금지, MFA 활성화
  - [ ] 0.5 `waganda` 계정에서 Bedrock 모델 액세스 승인 (계정별 설정이므로 신규 계정에서 다시 필요)
  - [ ] 0.6 서브도메인 위임 — `waganda` 계정에 `waganda.yanbert.com` 호스팅 존 생성 후, 관리 계정의 `yanbert.com` 존(`Z07510733MORPFMY88JZA`)에 NS 레코드 등록. `dig NS waganda.yanbert.com`으로 위임 확인
  - [ ] 0.7 GitHub Actions OIDC 자격증명 공급자 및 배포 역할 생성. 장기 액세스 키를 만들지 않는다
  - [ ] 0.8 `cdk bootstrap`을 대상 리전과 us-east-1(CloudFront 인증서용)에 실행
  - [ ] 0.9 AWS Budgets 생성 및 알림 대상 설정. 계정 단위이므로 태그 필터 없이도 이 프로젝트 비용만 집계됨을 확인
  - [ ] 0.10 서비스 쿼터 확인 — 신규 계정의 Bedrock TPM/RPM, Lambda 동시성, AgentCore 활성 세션 기본값이 워크로드에 충분한지 점검
  - _Requirements: 10, 11_

- [x] 1. 프로젝트 초기화 및 개발 환경 구성
  - [x] 1.1 npm workspaces 모노레포 초기화 — 루트 `package.json`에 `app`(루트), `packages/schemas`, `agent`, `infrastructure` 워크스페이스 등록
  - [x] 1.2 Next.js 15 App Router + TypeScript + Tailwind v4 초기화, `tsconfig.json` path alias(`@/`, `@waganda/schemas`) 설정
  - [x] 1.3 `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts` 구성. `npm run lint`, `npm run typecheck`, `npm run test` 스크립트 정의
  - [x] 1.4 와인 테마 적용 — `app/globals.css`에 컬러 토큰(버건디/골드/크림/다크) 정의, 다크 모드 기본, Playfair Display + Pretendard 폰트 로드
  - [x] 1.5 `infrastructure/` CDK 앱 초기화(`cdk.json`, `bin/waganda.ts`), 환경 컨텍스트(`dev`/`prod`) 분기 헬퍼 `lib/env.ts` 작성
  - [x] 1.6 `bin/waganda.ts`에 앱 수준 태깅 적용 — `Tags.of(app).add('Project','waganda')`, `Tags.of(app).add('Environment', env)`. 이후 모든 스택이 이를 상속
  - [x] 1.7 `.gitignore`, `.dockerignore`, `README.md` 작성. 시크릿 파일이 커밋되지 않도록 확인
  - _Requirements: 11_

- [ ] 2. 위험 선제 스파이크 (기능 구현 전 필수 관문)
  - [ ] 2.1 `infrastructure/lib/data-stack.ts` 최소 구성 배포 — DynamoDB 테이블(온디맨드, PITR), 미디어 S3 버킷, 에이전트 세션 S3 버킷, ECR 리포지토리
  - [ ] 2.2 `agent/src/entrypoint.ts`에 `/invocations` POST + `/ping` GET 구현, `agent/Dockerfile`을 `linux/arm64`로 작성. ECR 푸시 후 `AWS::BedrockAgentCore::Runtime` + `::RuntimeEndpoint`로 배포하고 호출 성공 확인
  - [ ] 2.3 Strands `S3SessionManager`로 동일 `runtimeSessionId`(33자 이상) 두 번 호출 시 상태가 복원되는지 확인. 복원되지 않아도 설계상 정합성은 DB가 보장하므로 결과를 문서에 기록만 한다
  - [ ] 2.4 실제 부부 시음 녹음 샘플로 Transcribe(`ko-KR`, `ShowSpeakerLabels`, `MaxSpeakerLabels: 2`) 화자분리 품질 측정. 화자별 F0 중앙값 차이를 계산해 설계의 gap 임계값(60Hz / 30Hz)이 타당한지 검증하고 필요 시 조정
  - [ ] 2.5 `opentelemetry-instrumentation` 의존성만 추가해 ADOT 자동 계측으로 Strands 스팬이 CloudWatch에 나타나는지 확인
  - [x] 2.6 스파이크 결과를 `docs/issues/spike-findings.md`에 기록. 2.2 또는 2.4가 실패하면 진행을 멈추고 방향을 재논의한다
  - _Requirements: 5, 10, 11_

- [x] 3. 공유 스키마 및 데이터 계층
  - [x] 3.1 `packages/schemas/`에 Zod 스키마 정의 — `wine.ts`, `winery.ts`, `region.ts`, `tasting.ts`, `recording.ts`, `analysis.ts`, `job.ts`, `profile.ts`, `discovery.ts`. 모든 스키마에 `schemaVersion` 필드 포함
  - [x] 3.2 `packages/schemas/tools.ts`에 에이전트 도구 입출력 계약과 `ComputeStatsSpec`(12개 `groupBy` 축) 정의. 프레임워크 비의존
  - [x] 3.3 `lib/db/client.ts` — DynamoDB DocumentClient 초기화, 테이블명 환경변수 주입
  - [x] 3.4 `lib/db/keys.ts` — 설계의 키 구조대로 `pk`/`sk`/`gsi1pk`/`gsi1sk` 생성 함수 작성
  - [x] 3.5 `lib/db/repository.ts` — 엔티티별 `get`/`put`/`patch`/`delete`, `queryTastingBundle(tastingId)`, `listByType(type, order)`, `scanAll()` 구현. 스토리지 교체 가능하도록 인터페이스 분리
  - [x] 3.6 `lib/db/upcast.ts` — `schemaVersion`이 낮은 레코드를 최신 형태로 승격. 파싱 실패 레코드는 로그 후 격리하고 전체 조회를 실패시키지 않음
  - [x] 3.7 `lib/db/integrity.ts` — 참조 존재 검증(`assertRefsExist`), 역참조 확인(`countTastingsForWine`), 낙관적 동시성(`rev` 대조 `ConditionExpression`) 헬퍼
  - [x] 3.8 테스트: 키 생성, 스키마 승격(구버전 레코드 읽기), 참조 무결성 위반 거부, 역참조 있는 삭제 거부, `rev` 충돌 시 오류 반환
  - _Requirements: 4, 11_

- [x] 4. 도메인 순수 로직
  - [x] 4.1 `lib/domain/speaker.ts` — `mapSpeakers(f0Track, segments)` 구현. gap ≥ 60 → high, 30~60 → medium, < 30 → 매핑 없음. F0 트랙을 화자 구간으로 슬라이스해 중앙값 산출 (오디오 Lambda 재호출 없음)
  - [x] 4.2 `lib/domain/stats.ts` — `computeStats(tastings, spec)` 구현. 12개 `groupBy` 축, 3개 `metric`, `minSampleSize` 필터, `deltaVsOverall` 산출
  - [x] 4.3 `lib/domain/discovery.ts` — `gradeDiscovery(group, overall)` 구현. n < 4 또는 |delta| < 0.5 → 미제시, n≥6 & |delta|≥1.0 → 뚜렷함, n≥5 & |delta|≥0.7 → 보통, 그 외 약함. `isDuplicate(groupBy, key, existing)` 포함
  - [x] 4.4 `lib/domain/profile.ts` — `buildTasteProfile(tastings)` 구현. 5건 미달 시 비활성 + 진행률, 4점 이상/2점 이하 공통 속성 추출, 표본 3건 미만은 "참고" 등급
  - [x] 4.5 `lib/domain/agreement.ts` — `computeAgreementScore(speakerA, speakerB)` 0~100 정규화, 월 단위 집계 `aggregateByMonth`
  - [x] 4.6 `lib/domain/region.ts` — 평면 지역 목록으로 계층 트리 구성 `buildRegionTree`, 경로 문자열 생성 `regionPath`
  - [x] 4.7 `lib/domain/search.ts` — 정규화 부분일치 검색 `matchWines(wines, query)` (이름·와이너리·지역·품종)
  - [x] 4.8 테스트: 각 함수의 정상 케이스와 경계·에러 케이스. 화자 매핑 gap 경계 3개 + 단일 화자 + F0 결측, 발견 등급 경계 4개, 프로파일 5건 경계, 빈 데이터·단일 그룹, 트리 순환 참조 방어
  - _Requirements: 5, 6, 7, 8, 9_

- [x] 5. 인증 (Google OAuth + 편집자 세션)
  - [x] 5.1 `lib/config.ts` — SSM Parameter Store에서 Google 클라이언트 ID/시크릿, JWT 서명 키, 허용 목록 주입. 미설정 시 즉시 실패
  - [x] 5.2 `lib/auth/session.ts` — `signEditorJWT`, `verifyEditorJWT`(허용 목록 **매 요청 재검증** 포함), `getEditorSession`, `requireEditor`, `isAllowedEmail`, `editorCookieOptions`(HttpOnly·Secure·SameSite=Lax)
  - [x] 5.3 `app/api/auth/google/start/route.ts` — `state` 난수 생성 후 쿠키 저장, `returnTo` 동봉, Google 인증 화면 리다이렉트
  - [x] 5.4 `app/api/auth/google/callback/route.ts` — `state` 대조, code→token→userinfo, `verified_email` 확인, 허용 목록 확인, JWT 발급, `returnTo` 복귀. 거부 시 세션 미발급 + 시도 기록
  - [x] 5.5 `app/api/auth/logout/route.ts` — 세션 쿠키 삭제
  - [x] 5.6 `lib/auth/guard.ts` — 쓰기 라우트 공통 가드. 미인증 시 `401 { error: 'UNAUTHORIZED', loginUrl }` 반환, `Origin` 헤더 동일 출처 검증
  - [x] 5.7 `components/auth/WriteActionGuard.tsx` — 401 수신 시 폼 초안을 `sessionStorage`에 보존하고 로그인으로 전환, 복귀 후 복원하는 클라이언트 훅
  - [x] 5.8 `app/robots.ts` — 인증·쓰기 API 경로 크롤링 제외
  - [x] 5.9 테스트: 세션 없음 → 401 + `loginUrl` 포함, 허용 목록 외 이메일의 유효 JWT → 무효 처리, 만료 JWT → 401, `state` 불일치 → 세션 미발급, `verified_email: false` → 거부, 잘못된 `Origin` 쓰기 → 거부, 폼 초안 보존·복원 UI 동작
  - _Requirements: 1_

- [x] 6. 와인 카탈로그 (API + UI)
  - [x] 6.1 `lib/services/wines.ts` — 와인·와이너리·지역 생성·수정·삭제 서비스. 중복 후보 탐지(`findDuplicateCandidates`: 이름+빈티지+와이너리), 참조 무결성·역참조 검증 연동
  - [x] 6.2 `app/api/wines/route.ts`(POST), `app/api/wines/[id]/route.ts`(PATCH, DELETE) — 편집자 가드 적용
  - [x] 6.3 `app/api/wineries/**`, `app/api/regions/**` — 동일 패턴
  - [x] 6.4 `components/wine/WineForm.tsx` — 이름만 필수, 나머지 선택. 저신뢰 필드 강조 표시 지원
  - [x] 6.5 `components/wine/DuplicateCandidateDialog.tsx` — 중복 후보 제시 후 기존 와인에 시음 추가 선택
  - [x] 6.6 테스트: 미인증 쓰기 → 401, 중복 조합 등록 시 후보 반환, 시음 기록 있는 와인 삭제 → 거부 + 연결 건수, 존재하지 않는 `wineryId` 참조 → 거부, 폼 조건부 렌더(저신뢰 강조)
  - _Requirements: 4_

- [x] 7. 시음 녹음 및 업로드
  - [x] 7.1 `components/record/AudioRecorder.tsx` — Web Audio API 녹음 시작/일시정지/종료, 경과 시간 및 실시간 음량 레벨 표시
  - [x] 7.2 `lib/upload/validate.ts` — 형식(`mp3`/`m4a`/`wav`/`webm`), 크기 50MB, 길이 10분 검증. 위반 시 한국어 사유 반환
  - [x] 7.3 `app/api/tastings/route.ts`(POST) — 시음 세션 생성. 시음자 정보는 받지 않음
  - [x] 7.4 `app/api/tastings/[id]/recordings/route.ts`(POST) — S3 사전 서명 업로드 URL 발급, `Recording` 레코드 생성, 세션당 최대 3개 제한
  - [x] 7.5 `lib/upload/resume.ts` — 업로드 실패 시 브라우저에 녹음 보존 및 재시도
  - [x] 7.6 `app/record/page.tsx` — 녹음·파일 업로드·와인 정보 입력을 묶은 기록 작성 화면
  - [x] 7.7 테스트: 형식·크기·길이 위반 거부와 한국어 메시지, 4번째 녹음 첨부 거부, 미인증 → 401, 업로드 실패 후 재시도 UI 동작
  - _Requirements: 2_

- [x] 8. 음향 특징 추출 Lambda (Python)
  - [x] 8.1 `audio/Dockerfile` — `linux/arm64`, ffmpeg 정적 바이너리 + numpy/scipy/praat-parselmouth 설치
  - [x] 8.2 `audio/handler.py` — S3에서 오디오 수신, 16kHz 모노 WAV 정규화, RMS 곡선·F0 트랙·침묵 구간(0.8초 이상)·발화 속도·웃음 후보 산출, 결과 JSON 반환
  - [x] 8.3 `audio/features.py` — 각 특징 계산 함수 분리. 웃음 감지는 휴리스틱임을 주석에 명시
  - [x] 8.4 `infrastructure/lib/pipeline-stack.ts`에 오디오 Lambda(컨테이너, ARM64) 추가 및 미디어 버킷 읽기 권한 부여
  - [x] 8.5 테스트: 샘플 오디오로 각 특징 산출 검증, 무음 파일·초단시간 파일·손상 파일 처리, 출력이 `packages/schemas`의 `acoustic` 스키마와 일치하는지 확인
  - _Requirements: 5_

- [x] 9. 라벨 인식 에이전트
  - [x] 9.1 `agent/src/agents/label.ts` — Strands 에이전트 정의. 멀티모달 입력으로 와인명·빈티지·와이너리·국가·지역·품종·알코올 도수 추출, 필드별 신뢰도(high/medium/low) 부여
  - [x] 9.2 `agent/src/tools/catalog.ts` — `findWines`, `getWine` 읽기 전용 도구 구현
  - [x] 9.3 `agent/src/tools/web.ts` — `webSearch` 도구. 정보 부족 시 보강하고 출처 URL 기록
  - [x] 9.4 라벨 시각 태그(동물/식물/인물/미니멀/화려/필기체/색조)와 물리 속성(병 형태, 코르크/스크류캡) 추출을 프롬프트와 출력 스키마에 포함 — R8 탐색 축의 원천 데이터
  - [x] 9.5 `infrastructure/lib/data-stack.ts`에 Bedrock 애플리케이션 추론 프로파일 생성(`Project: waganda` 태그 포함). 에이전트는 모델 ID 대신 이 프로파일 ARN을 호출하여 토큰 비용이 태그로 귀속되게 함
  - [x] 9.6 `lib/agent/client.ts` — `InvokeAgentRuntime` 래퍼. 세션 ID 생성(33자 이상 보장 + 길이 검증), 상한 파라미터 전달
  - [x] 9.7 `app/api/labels/analyze/route.ts` — 편집자 가드 필수(모델 호출 비용 보호), 이미지 키 수신 후 에이전트 호출
  - [x] 9.8 테스트: 미인증 → 401(비용 보호 회귀 방지), 출력 스키마 검증, 인식 실패 시 수동 입력 폼 전환, 저신뢰 필드 강조 렌더, 기존 카탈로그 일치 시 신규 생성 대신 후보 제시
  - _Requirements: 3_

- [x] 10. 분석 파이프라인 기반 (세션 A)
  - [x] 10.1 `infrastructure/lib/pipeline-stack.ts` — SQS 큐 + DLQ(최대 수신 3회), S3 업로드 이벤트 → SQS 알림 설정
  - [x] 10.2 `infrastructure/lambda/trigger-upload.ts` — SQS 소비 후 `InvokeAgentRuntime` 호출(세션 A)
  - [x] 10.3 `agent/src/graph/pipeline.ts` — Strands `GraphBuilder`로 그래프 정의. 고정 노드와 조건부 엣지 분리
  - [x] 10.4 `agent/src/graph/nodes/ensureJob.ts` — 작업 레코드 생성·조회(멱등). 이미 `analyzing` 이상이면 즉시 종료
  - [x] 10.5 `agent/src/graph/nodes/startTranscription.ts` — Transcribe 작업 시작(`ko-KR`, 화자분리 2명). 작업명은 `tastingId`+녹음ID 기반 결정론적 생성으로 중복 방지
  - [x] 10.6 `agent/src/graph/nodes/extractAcoustic.ts` — 오디오 Lambda 호출 및 결과 저장. 이미 존재하면 건너뜀
  - [x] 10.7 `app/api/tastings/[id]/analyze/route.ts` — 편집자 가드 필수. 재분석 트리거
  - [x] 10.8 `components/tasting/AnalysisStatus.tsx` — `queued`/`transcribing`/`analyzing`/`completed`/`failed` 표시, 진행 중 예상 소요 시간, 완료 시 자동 갱신 및 브라우저 알림
  - [x] 10.9 테스트: 동일 오디오 중복 트리거 시 Transcribe 작업 중복 생성 없음, `completedSteps` 기반 단계 스킵, 미인증 재분석 → 401, 상태별 UI 조건부 렌더
  - _Requirements: 5_

- [x] 11. 소믈리에 에이전트 및 세션 B 그래프
  - [x] 11.1 `infrastructure/lib/pipeline-stack.ts`에 EventBridge 규칙 추가 — Transcribe Job State Change(`COMPLETED`/`FAILED`) → `infrastructure/lambda/trigger-transcribe.ts` → 세션 B 호출(세션 A와 동일 `runtimeSessionId`)
  - [x] 11.2 `agent/src/graph/nodes/loadState.ts` — 작업 상태·트랜스크립트·음향 특징 적재, `completedSteps`로 이후 분기 결정
  - [x] 11.3 `agent/src/graph/nodes/mapSpeakers.ts` — `lib/domain/speaker.ts` 호출해 실명 매핑 및 신뢰도 저장
  - [x] 11.4 `agent/src/agents/sommelier.ts` — ReAct 에이전트. 요약·하이라이트·평점(0.5 단위)·5축 노트 생성, 각 항목의 근거(발화 또는 음향 신호) 필수 반환
  - [x] 11.5 `agent/src/tools/tastings.ts` — `getTastingsForWine`, `getRecentTastings`, `findSimilarTastings`(품종·지역·5축 유사), `getTasteProfile` 읽기 전용 도구
  - [x] 11.6 감탄사·의성어 감정 강도 매핑, 침묵·웃음 해석, 10단어 이하 시 과장 확장, 과거 대비 변화 코멘트, 두 화자 대비 코멘트(매핑 시 실명·불확실 시 중립 표현)를 프롬프트에 반영
  - [x] 11.7 `agent/src/lib/validate.ts` — 출력 Zod 검증 및 위반 시 최대 2회 재생성. 2회 후 실패 시 원본 보존 + 재분석 버튼 노출
  - [x] 11.8 `agent/src/graph/nodes/persistAndPublish.ts` — 결과 저장(쓰기는 결정론적 노드에서만), 작업 완료 처리, CloudFront `/*` 무효화 발행
  - [x] 11.9 `app/api/tastings/[id]/route.ts`(PATCH) — 수동 평점, 요약·하이라이트 수정. 원본 AI 생성물 보존
  - [x] 11.10 `app/api/recordings/[id]/speakers/route.ts`(PATCH) — 화자 매핑 교체(오판 정정)
  - [x] 11.11 테스트: 트랜스크립트 무음 시 실패 처리 안 함, 화자분리 실패 시 화자 의존 서술 생략, 스키마 위반 2회 재생성 후 실패, 세션 B 중복 호출 시 결과 중복 없음, 수정 시 원본 보존, 미인증 PATCH → 401
  - _Requirements: 5, 6_

- [x] 12. 취향 프로파일 에이전트
  - [x] 12.1 `agent/src/tools/stats.ts` — `computeStats` 도구. `lib/domain/stats.ts`를 호출하며 `ComputeStatsSpec`으로 입력을 제한(임의 코드·SQL 불가)
  - [x] 12.2 `agent/src/agents/tasteProfile.ts` — 계산 도구 결과를 근거로 선호·비선호 패턴 요약, 다음 와인 유형 추천 3건, 와인샵용 한줄 구매 가이드 생성
  - [x] 12.3 `agent/src/graph/nodes/refreshProfile.ts` — 조건부 노드. 완료 시음 수가 5의 배수일 때만 실행하는 결정론적 술어
  - [x] 12.4 `components/profile/TasteProfileCard.tsx` — 5축 레이더 차트 + 키워드 태그. 5건 미달 시 비활성 + 진행률
  - [x] 12.5 `components/wine/FitBadge.tsx` — 취향 적합도 뱃지(딱 맞아 / 도전적 / 비선호 구간)
  - [x] 12.6 `components/profile/AgreementTrend.tsx` — 월별 반응 일치도 추이 차트
  - [x] 12.7 테스트: 5건 경계에서 활성화, 5의 배수에서만 갱신 트리거, 표본 3건 미만 "참고" 표기, 비활성 상태 조건부 렌더, `computeStats` 도구가 스펙 외 입력 거부
  - _Requirements: 7_

- [x] 13. 패턴 발견 에이전트
  - [x] 13.1 `agent/src/agents/discovery.ts` — 정통 축과 비전통 축을 탐색해 예상치 못한 패턴을 찾는 에이전트. `computeStats`와 `listDiscoveries` 사용
  - [x] 13.2 `agent/src/graph/nodes/runDiscovery.ts` — 조건부 노드. 완료 시음 10건 이상이고 마지막 실행 이후 5건 이상 증가했을 때만 실행
  - [x] 13.3 발견 카드 생성 — 패턴 서술, 재미있는 별칭, 근거 시음 링크, 표본 수, 신뢰 등급(약함/보통/뚜렷함), 우연 가능성 문구
  - [x] 13.4 `lib/services/discoveries.ts` — 중복 차단(`groupBy`+`key` 조합), 표본 증가 시 갱신 알림, 숨김 처리
  - [x] 13.5 `app/api/discoveries/[id]/hide/route.ts`(PATCH) — 편집자 가드
  - [x] 13.6 `app/(public)/discoveries/page.tsx` + `components/discovery/DiscoveryCard.tsx` — 최신순 목록, 대시보드 노출, 신규 와인 등록 시 해당 카드 태그 표시
  - [x] 13.7 테스트: 10건 미달 시 미실행, n<4 또는 |delta|<0.5 미제시, 등급 경계 4개, 중복 미제시, 숨긴 카드 재제시 안 함, 미인증 숨김 → 401
  - _Requirements: 8_

- [x] 14. 공개 열람 뷰
  - [x] 14.1 `app/(public)/page.tsx` — 대시보드(최근 시음, 취향 카드, 최근 반응 일치도, 최신 발견 카드, 진행 중 분석)
  - [x] 14.2 `app/(public)/tastings/[id]/page.tsx` — 라벨 사진, 메타데이터, 오디오 플레이어, 트랜스크립트, 하이라이트, 5축 레이더, 감정 타임라인, 과거 기록
  - [x] 14.3 `components/tasting/AudioPlayer.tsx` — 재생 위치에 해당하는 트랜스크립트 구간 강조, 화자 이름(또는 화자 번호) 표시
  - [x] 14.4 `app/(public)/wines/page.tsx`, `wines/[id]/page.tsx` — 목록·검색, 상세에서 시음 이력 시간순 + 평점 추이 선 차트
  - [x] 14.5 `app/(public)/explore/[[...path]]/page.tsx` — 국가 > 지역 > 세부 산지 계층 탐색 + 브레드크럼
  - [x] 14.6 `app/(public)/timeline/page.tsx`, `wineries/[id]/page.tsx`, `rankings/page.tsx` — 타임라인, 와이너리별, 평점순(AI/수동 기준 선택)
  - [x] 14.7 편집·삭제 컨트롤을 세션 유무와 무관하게 렌더링하고 실행 시 로그인 흐름으로 전환하도록 각 뷰에 `WriteActionGuard` 연결
  - [x] 14.8 공유용 메타데이터(제목·설명·대표 이미지) 및 모바일 375px 폭 반응형 확인
  - [x] 14.9 테스트: 미인증 방문자에게 편집 컨트롤이 렌더링되고 클릭 시 로그인 전환, 재생 위치 트랜스크립트 강조, 화자 매핑 불확실 시 실명 미표시, 지역 계층 브레드크럼, 데이터 없는 상태 렌더
  - _Requirements: 9_

- [x] 15. 캐시·무효화 및 남용 방지
  - [x] 15.1 `infrastructure/lib/web-stack.ts` — CloudFront 캐시 정책 분리(`/_next/static/*` 1년 immutable, `/media/*` 장기, 공개 페이지 장기, `/api/*`·`/record` 캐시 안 함)
  - [x] 15.2 미디어·정적 버킷에 OAC 적용, S3 직접 접근 차단
  - [x] 15.3 `lib/cache/invalidate.ts` — 쓰기 성공 시 `/*` 무효화 발행. 쓰기 API와 `persistAndPublish` 노드에서 호출
  - [x] 15.4 `lib/ratelimit.ts` — DynamoDB 조건부 증가 + TTL 카운터 기반 IP 속도 제한. `middleware.ts`에서 API 경로에 적용
  - [x] 15.5 테스트: 무효화 호출 여부, 속도 제한 초과 시 차단과 윈도우 만료 후 해제, S3 직접 접근 차단 확인
  - _Requirements: 1, 11_

- [x] 16. 가드레일 및 관측성
  - [x] 16.1 AgentCore 상한 명시 설정 — `maxIterations: 12`, `maxTokens` 예산, `timeoutSeconds: 300`, `idleRuntimeSessionTimeout: 60`, `maxLifetime: 900`. 서비스 기본값에 의존하지 않음
  - [x] 16.2 `agent/src/lib/trace.ts` — 단계·도구 호출·입출력 요약·지연시간·토큰 사용량·비용 추정·프롬프트 버전을 기록. 오케스트레이터와 서브에이전트를 계층 구조로 남김
  - [x] 16.3 `agent/src/prompts/` — 프롬프트를 파일로 버전 관리하고 각 트레이스에 버전 기록
  - [x] 16.4 `lib/ops/budget.ts` — 일간 실행 횟수 및 월간 모델 비용 집계. 80%·100% 알림, 100%에서 신규 에이전트 실행 차단
  - [x] 16.5 시스템 지시와 사용자 데이터(트랜스크립트·라벨)를 구분된 채널로 전달하고, 사용자 데이터 내 지시문을 따르지 않도록 시스템 프롬프트에 명시
  - [x] 16.6 트레이스·운영 지표가 공개 화면에 노출되지 않는지 확인
  - [x] 16.7 테스트: 상한 초과 시 실행 중단 및 부분 결과 보존, 예산 100% 도달 시 신규 실행 차단, LLM 노출 도구가 전부 읽기 전용인지 정적 검증, 프롬프트 인젝션 샘플 입력에서 도구 오용 없음
  - _Requirements: 10_

- [ ] 17. 인프라 마감
  - [x] 17.1 `infrastructure/lib/web-stack.ts` 완성 — Next.js Lambda(ARM64 컨테이너), Function URL + OAC, 정적 자산 S3 업로드, CloudFront 배포
  - [ ] 17.2 도메인 연결 — `waganda` 계정의 `waganda.yanbert.com` 호스팅 존 조회, us-east-1에 ACM 인증서 신규 발급(DNS 검증, 위임 완료 후 자동), CloudFront에 연결하고 A/AAAA 별칭 생성
  - [x] 17.3 `infrastructure/lib/ops-stack.ts` — 로그 그룹(14일 보관), `Project: waganda` 태그로 필터링한 AWS Budgets, SNS 알림 토픽, 실패율·지연시간·스키마 검증 실패율 알람
  - [x] 17.4 SSM Parameter Store SecureString 파라미터 정의(Google 클라이언트 ID/시크릿, JWT 서명 키, 허용 목록). Secrets Manager 미사용
  - [x] 17.5 ~~dev/prod 분리 배포~~ — dev 환경을 두지 않기로 결정(prod 단독 배포)
  - [x] 17.6 상시 과금 리소스 부재 검증 — ALB·NAT 게이트웨이·상시 컨테이너·프로비저닝 DB가 합성 결과에 없는지 `cdk synth` 산출물로 확인하는 테스트 작성
  - [x] 17.7 태깅 검증 — `cdk synth` 산출물의 모든 태깅 가능 리소스에 `Project: waganda`가 부여되었는지 확인하는 테스트 작성. 비용 격리는 계정 경계가 1차 수단이며 태그는 조직 전체 조회용임을 전제로, 배포 후 Cost Explorer에서 계정·태그 양쪽 조회를 확인
  - _Requirements: 11_

- [ ] 18. CI/CD 및 배포
  - [x] 18.1 `.github/workflows/ci.yml` — lint, typecheck(app·agent·infrastructure), test, build. 하나라도 실패 시 배포 중단
  - [x] 18.2 ARM64 컨테이너 빌드 — web·agent·audio 3개 이미지를 ARM 러너 또는 QEMU 크로스 빌드로 ECR 푸시
  - [x] 18.3 에이전트 이미지 크기 검사 단계 추가 — AgentCore 상한 2 GB에 근접하면 실패
  - [x] 18.4 `.github/workflows/deploy.yml` — 작업 0.7의 OIDC 역할을 assume해 `dev` 배포 → 스모크 테스트 → `prod` 배포. 장기 액세스 키 미사용
  - [x] 18.5 스모크 테스트 스크립트 — 공개 페이지 200 응답, 미인증 쓰기 401, 에이전트 엔드포인트 `/ping` 정상
  - [ ] 18.6 실제 시음 1건 전체 흐름 수동 검증 — 녹음 업로드 → Transcribe → 화자 매핑 → 분석 → 화면 반영 → CDN 무효화
  - [ ] 18.7 배포 후 실제 비용 확인 및 목표치(월 $10 이하, 유휴 달 $2 이하) 대비 점검
  - _Requirements: 11_
