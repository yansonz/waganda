---
inclusion: always
---

# 기술 스택과 코딩 규약

## 스택

| 영역 | 선택 |
|---|---|
| 웹 | Next.js 15.5 App Router, React 19, Tailwind CSS 4 |
| 언어 | TypeScript 5.9 strict, Node 22+ / Python 3.12 (audio) |
| 검증 | **zod 4.4.3** (Strands TS SDK 가 zod ^4 를 피어로 요구) |
| 저장소 | DynamoDB 단일 테이블 (PK/SK + GSI1), S3 미디어 |
| 모델 | Amazon Bedrock (Claude), Amazon Transcribe (화자 분리) |
| 에이전트 | `@strands-agents/sdk` 1.11.2, AgentCore Runtime (ARM64) |
| 인프라 | AWS CDK (`infrastructure/`), GitHub Actions |
| 테스트 | vitest 3.2, Playwright 1.62, pytest |

AWS SDK 는 전 워크스페이스가 **3.1097.0 으로 고정**돼 있다. 버전을 흩뜨리지 말 것.

## 코딩 규약

- **주석·테스트 이름·커밋 메시지는 한국어.** 식별자(변수·함수·타입)는 영어.
- `any` 금지, `as` 단정 최소화. 타입은 `packages/schemas` 에서 가져온다.
- 스키마를 새로 만들지 말고 `@waganda/schemas` 에 추가한다. 앱·에이전트·인프라·테스트가
  같은 정의를 공유하는 것이 이 프로젝트의 유일한 계약 수단이다.
- 프리티어 설정은 `.prettierrc.json` (singleQuote, printWidth 100). 기본 설정으로 포맷하면
  42개 파일이 이중 인용부호로 뒤집힌다.
- 커밋 메시지는 Conventional Commit (`feat(scope): 설명`), 본문에 "왜"를 남긴다.

## AWS 호출은 주입 가능하게

외부 호출은 모듈 스코프 setter 로 교체할 수 있게 만든다. 테스트가 이 지점으로 들어온다.

```
setDocClient / setDynamoDocClient / setS3Client / setRecordingPresigner
setTranscribeClient / setCloudFrontClient / setCloudFrontInvalidator
setLambdaClient / setAgentRuntimeInvoker
```

새 외부 의존을 추가할 때도 같은 패턴을 따른다. 함수 안에서 클라이언트를 직접 `new` 하면
테스트가 실제 AWS 를 때린다.

## 검증 (변경 후 반드시)

```bash
npx tsc --noEmit          # 0 이어야 함
npx eslint .              # 0 이어야 함
npm test                  # 루트 vitest (~600건)
npm run test:agent        # agent
npm run test:infra        # infrastructure (cdk synth 포함)
```

Python 은 가상환경을 만들고 실행한다(`audio/`, pytest 37건).
