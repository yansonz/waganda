---
inclusion: always
---

# Git 워크플로 정책

이 저장소(`yansonz/waganda`)의 git 규약이다. Issue Radar 로 이슈·PR 을 조사하다가
그대로 수정·PR 까지 이어갈 때 매번 판단하지 않도록 못박아 둔다.
커밋 메시지 형식은 `tech.md`(Conventional Commit)를 따르고, 여기서는 브랜치·PR·Issue Radar
연동 정책만 다룬다.

## 브랜치와 push

- **`main` 은 보호 브랜치다. 직접 push 하지 않는다.** 모든 변경은 피처 브랜치 + PR 로만 들어간다.
  main push 는 GitHub Actions 배포(ARM64 이미지 빌드 → CDK deploy → 정적 자산 동기화 →
  CloudFront 무효화 → 스모크 테스트)를 즉시 트리거하므로, 리뷰·CI 를 통과하지 않은 커밋이
  바로 프로덕션(`https://waganda.yanbert.com`)에 나간다.
- push 는 브랜치 이름을 명시한다(`git push origin <feature-branch>`). 인자 없는 `git push`,
  `HEAD`/`@` 대상, force-push 는 쓰지 않는다.
- 피처 브랜치가 아직 로컬에만 있으면 `-u` 로 원격 추적을 함께 설정한다
  (`git push -u origin <feature-branch>`).

## 이슈 → 수정 → PR 규약

Issue Radar 로 이슈를 조사하다 수정이 필요하다는 결론이 나면, 조사 세션에서 바로 고쳐도 되지만
**`main` 에는 절대 직접 넣지 않는다.** 아래 git 규약으로 피처 브랜치 + PR 을 만든다.

- 브랜치 이름은 작업 종류 + 이슈 번호로 짓는다: `fix/issue-<번호>-<짧은설명>`,
  `feat/issue-<번호>-<짧은설명>`. 조사한 이슈 번호를 브랜치에 남겨 추적을 잇는다.
- PR 본문에 원 이슈를 연결한다. 버그 수정이면 `Closes #<번호>`, 관련일 뿐이면 `Refs #<번호>`.
  이러면 병합 시 이슈가 자동으로 닫히고 Issue Radar 카드와 PR 이 연결된다.
- PR 은 `gh pr create` 로 만든다. 제목은 70자 이내 Conventional Commit 형식,
  본문에는 변경 요약 / 테스트한 것 / 원 이슈 링크를 담는다.
- 결함 수정에는 회귀 테스트를 함께 넣는다(`testing.md`). CI(`tsc`·eslint·vitest·agent·infra)가
  녹색이 된 뒤에만 병합한다 — 병합이 곧 배포이기 때문이다.

## 커밋

- 사용자가 명시적으로 요청할 때만 커밋한다. 특정 파일만 스테이징하고 `git add .` 는 피한다.
- 시크릿 가능성이 있는 파일(`.env.local`, `test-data/`, 계정 ID)은 커밋 전에 짚는다
  (`local-dev.md` 의 "절대 커밋하지 않는 것"). 커밋 전 `git status --porcelain -uall` 로 대상 확인.
- 본문에 "왜" 를 남긴다. 훅(`--no-verify`)은 명시적 지시 없이는 건너뛰지 않는다.
