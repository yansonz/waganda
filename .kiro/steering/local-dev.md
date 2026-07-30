---
inclusion: always
---

# 로컬 개발, 비용, 보안

## 실행

```bash
npm run dev          # DynamoDB Local + LocalStack S3 자동 기동 후 next dev
npm run dev:login    # 로컬 편집자 세션 쿠키 발급 (dev/prod 환경에서는 실행 거부)
npm run db:reset     # 로컬 테이블 재생성 + 시드
npm run analyze:local -- <tastingId>   # 분석 파이프라인 수동 실행
```

환경변수는 `.env.local` (gitignored). 필요한 키 목록은 `.env.example` 이 원본이니
새 변수를 읽는 코드를 추가하면 `.env.example` 에도 빈 값으로 추가한다.

## 실제 AWS 를 호출한다 — 비용 주의

로컬은 DB·S3 만 에뮬레이터이고 **Bedrock 과 Transcribe 는 실제 계정을 호출한다.**
`WAGANDA_LOCAL_PIPELINE=1` 이면 녹음 저장 직후 분석이 자동으로 돌아간다(녹음 1건당 2~3센트).
반복 검증 스크립트를 짤 때 모델 호출을 루프에 넣지 말 것.

- Bedrock 은 **추론 프로파일 ID** 로만 호출된다. 온디맨드 모델 ID 는 거부된다.
- 라벨 인식을 로컬에서 쓰려면 `WAGANDA_LABEL_FALLBACK=bedrock`.
- Transcribe 입력은 별도 버킷(`WAGANDA_TRANSCRIBE_BUCKET`)을 쓰고, 러너가 작업 직후
  입력 파일을 삭제한다. **개인 음성을 클라우드에 남기지 않는다.**

## 절대 커밋하지 않는 것

`.gitignore` 로 차단되어 있고, 이 차단을 약화시키는 변경은 하지 않는다.

- `.env.local` 등 실제 환경변수 파일
- `test-data/` — 실제 라벨 사진(HEIC)과 부부의 실제 음성(m4a)이 들어 있다
- AWS 계정 ID·자격증명·실제 이메일 주소.
  픽스처는 `@example.com` 을 쓰고, 문서에는 `<AWS 계정 ID>` 처럼 자리표시자를 쓴다.

커밋 전에 `git status --porcelain -uall` 로 대상 전체를 확인한다.

## 로컬 데이터는 휘발성이다

`scripts/local-ddb.ts` 는 DynamoDB Local 을 `-inMemory` 로 띄운다. 컨테이너를 내리면
기록이 사라진다. 특히 **E2E 실행이 개발용 컨테이너를 재생성해 손으로 만든 기록을 날린 사례가
있다.** 실제 녹음·분석으로 만든 데이터를 남겨야 하는 상황이면 E2E 를 돌리기 전에 알린다.
