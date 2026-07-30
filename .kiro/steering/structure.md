---
inclusion: always
---

# 구조와 계층 규칙

## 워크스페이스

```
/                     Next.js 앱 (루트가 웹 워크스페이스)
packages/schemas      zod 스키마 — 모든 계약의 단일 원본
agent                 Strands 분석 파이프라인 (AgentCore Runtime)
infrastructure        CDK 스택 (data / web / pipeline / ops)
audio                 녹음 전처리 Lambda (Python, 워크스페이스 아님)
```

## 앱 내부 계층

```
app/api/**            HTTP 경계. 파싱·인증·상태코드만. 로직을 두지 않는다.
lib/services/**       유스케이스 조합 (여러 레포지토리·에이전트 호출을 묶는 곳)
lib/db/**             DynamoDB 접근. 키 설계는 lib/db/keys.ts
lib/domain/**         순수 함수. AWS·IO 의존 금지 (화자 판별·통계·발견·취향·일치도)
lib/views/**          읽기 전용 조회 모델 (화면이 필요한 형태로 조립)
lib/agent/**          Bedrock 직접 호출 (라벨 인식·보강·소믈리에 분석)
lib/analysis/**       로컬 분석 파이프라인 (CLI 와 API 자동 실행이 공유)
lib/auth/**           Google OAuth + 편집자 JWT 세션
lib/upload/**         S3 사전 서명, 이미지 준비(HEIC 변환)
components/**         도메인별 UI (auth/common/label/record/tasting/wine/...)
```

규칙:

- **도메인 규칙은 `lib/domain` 에 순수 함수로 넣는다.** 라우트나 컴포넌트에 판정 로직을
  흘리지 않는다. 여기 있는 것만이 단위 테스트로 고정된 사양이다.
- **API 라우트에서 DB 를 직접 만지지 않는다.** `lib/services` 또는 `lib/views` 를 거친다.
- **쓰기 라우트는 예외 없이 편집자 가드를 통과해야 한다.** 새 쓰기 엔드포인트를 추가하면
  가드와 E2E 단정(`e2e/auth-write-guard.spec.ts`)도 함께 추가한다.
- 서버 컴포넌트가 기본이다. 클라이언트 컴포넌트는 상호작용이 필요한 최소 단위로 자른다.

## 세션 판별은 브라우저에서

공개 페이지는 CDN 장기 캐시 대상이다. 서버 HTML 에 세션별 UI 를 넣으면 캐시가 오염돼
비로그인 사용자에게 편집 버튼이 노출된다. 그래서 `components/auth/EditorSession.tsx` 의
`EditorSessionProvider` / `useEditorSession` / `EditorOnly` 로 클라이언트에서 판별한다.
편집 UI 를 추가할 때 `EditorOnly` 로 감싼다.

## 알려진 미연결 컴포넌트

`components/wine/WineForm.tsx` 와 `DuplicateCandidateDialog` 는 현재 화면에 붙어 있지 않다
(테스트만 존재). 원래 자리는 "확인 필요" 상태인 와인 초안을 사람이 손보는 편집 화면이고,
그 화면이 아직 없다. 초안 편집 UI 를 만들 때 새로 짜지 말고 이 둘을 연결한다.
