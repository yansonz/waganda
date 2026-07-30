---
inclusion: always
---

# 테스트 규약

## 위치

```
__tests__/**              루트 앱 (db/domain/api/services/views/components/... 하위로 분류)
agent/test/**             agent 워크스페이스
infrastructure/test/**    CDK 스택 단정
audio/tests/**            pytest
e2e/**                    Playwright
```

테스트 이름은 한국어로, **무엇을 보장하는지** 쓴다. "동작한다" 같은 이름은 쓰지 않는다.

## 자주 걸리는 설정

- `jose` 를 쓰는 테스트는 파일 첫 줄에 `// @vitest-environment node` 가 필요하다.
- `next/headers` 는 `vi.mock` 으로 대체한다.
- 인증이 필요한 API 테스트 패턴: `cookieStore` Map + `vi.mock('next/headers')` +
  `signEditorJWT` 로 실제 서명된 토큰을 넣는다. 가드를 우회하는 목을 만들지 않는다.
- AWS 는 `setDocClient` 등 주입 setter 로 대체한다. 네트워크를 타면 잘못 쓴 것이다.

## 테스트가 사양을 고정한다

- **테스트가 상수를 다시 적어두지 않게 한다.** GSI 인덱스명을 테스트에 문자열로 박아둔 탓에
  대소문자 불일치(`gsi1` vs `GSI1`)를 테스트가 오히려 통과시킨 사고가 있었다.
  프로덕션 코드의 상수를 import 해서 단정한다.
- 결함을 고칠 때는 회귀 테스트를 반드시 함께 남긴다.
- `infrastructure/test` 의 `no-always-on-cost`, `web-stack` 은 스펙 요구사항이다.
  통과가 어렵다고 삭제하지 않는다(실제로 삭제됐다가 복원된 이력이 있다).

## E2E

- `WAGANDA_RATE_LIMIT_MAX` 를 크게 잡아 속도 제한에 걸리지 않게 한다
  (`playwright.config.ts` 의 `webServer.env`).
- 시나리오 간 데이터 오염을 막으려면 **변경 대상 레코드를 시나리오별로 분리**한다.
  공유 시드를 수정하는 테스트를 추가하지 않는다.
- E2E 는 컨테이너를 재생성한다. 로컬 개발 데이터를 파괴한다는 점을 항상 염두에 둔다.
