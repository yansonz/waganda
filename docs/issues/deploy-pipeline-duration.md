# GitHub Actions 배포 파이프라인 소요시간 점검

> 기준일: 2026-07-31
> 범위: `.github/workflows/{deploy.yml,ci.yml}`, `scripts/{smoke-test.sh,check-agent-image-size.sh}`,
> 실제 실행 기록(`gh run view`, run id 30565927257/30565927492, 2026-07-30 17:25~17:36,
> 결론 success). 구현 변경은 없다.

## 요약

실측 총 소요시간 **10분 4초** (17:25:53 push → 17:35:57 smoke-test 완료).
구간별로는 **CI 재검증(4분 34초) > cdk deploy(3분 8초) > 이미지 빌드(2분)** 순으로 크고,
`ci.yml` 이 **push 시 1번 + deploy.yml 재사용 호출로 1번, 총 2번 전부 재실행**되는 구조가
가장 큰 낭비다. E2E(Playwright)가 CI 내부에서 단일 최장 job(2분 30초)으로 전체 CI 시간을
좌우한다.

| 구간 | 소요 | 비중 |
| --- | --- | --- |
| preflight | 2초 | - |
| CI 재검증 (6 job 병렬, 최장 E2E) | 4분 34초 | 45% |
| build-web / build-agent / build-audio (병렬) | 2분 | 20% |
| check-agent-image-size | 18초 | 3% |
| cdk deploy (prod) | 3분 8초 | 31% |
| smoke-test | 11초 | 2% |

## 1. 실측 타임라인 (run 30565927492 / 30565927257)

```
17:25:53  push
17:25:56  preflight 시작 ────────── 17:25:58 (2초)
17:25:56  ci.yml (재사용) 시작
            lint          17:25:55→17:26:28 (33초)
            typecheck     17:25:55→17:26:41 (46초)
            test          17:25:56→17:27:26 (90초)
            audio-test    17:26:02→17:26:21 (19초)
            build(next)   17:27:28→17:28:42 (74초, lint/typecheck/test 이후 시작)
            e2e           17:27:33→17:30:03 (150초, lint/typecheck/test 이후 시작) ← 최장
            게이트        17:30:11→17:30:14
          ci.yml 전체 종료: 17:30:15  (약 4분 22초)
17:30:33  build-web 시작 ─────────── 17:32:32 (119초)
17:30:33  build-agent 시작 ───────── 17:31:08 (35초)
17:30:36  build-audio 시작 ───────── 17:30:59 (23초)
17:31:11  check-agent-image-size ─── 17:31:29 (18초, build-agent 후 재pull)
17:32:35  cdk deploy 시작 ────────── 17:35:43 (188초)
17:35:46  smoke-test ─────────────── 17:35:57 (11초)
```

## 2. 가장 큰 낭비 — `ci.yml` 이중 실행

`deploy.yml` 의 `ci` job 이 `uses: ./.github/workflows/ci.yml` 로 CI 전체를 **재사용
워크플로 호출**한다. 코드는 이미 PR 단계(push to main 이전 또는 PR)에서 한 번
`ci.yml` 이 돈 뒤 머지된 것이므로, main 에 push 되는 순간 배포 워크플로가 **완전히
동일한 lint/typecheck/test/build/e2e/audio-test 6개 job 을 처음부터 다시** 실행한다.

의도(주석)는 "머지된 코드라도 배포 직전에 재검증"이지만, 실측상 이 재검증이 전체
파이프라인의 45%(4분 34초)를 차지한다. 근본 원인을 나누면:

- **재검증 자체의 필요성은 있다** — main 브랜치 보호 규칙이 없거나 강제 머지가
  가능하다면 재검증이 최후의 방어선이다.
- 그러나 **E2E(Playwright)를 배포 게이트에 포함시킨 것**이 비용 대비 효과가 낮다.
  E2E 는 이미 PR 단계에서 통과했을 가능성이 높고, `README`/`docs` 만 바뀐 커밋도
  E2E 전체(150초)를 다시 돌린다.
- `npm ci` 가 이 파이프라인 안에서 **최소 7번**(lint/typecheck/test/build/e2e/
  audio-test 각 1회 + deploy-prod 1회) 독립적으로 실행된다. `actions/setup-node`
  의 npm 캐시(`~/.npm`)는 다운로드만 줄여주고 `npm ci` 의 압축 해제·심볼릭 링크
  구성 자체는 매번 반복된다.

## 3. 이미지 빌드 — 이미 상당히 최적화되어 있음

- `ubuntu-24.04-arm` 네이티브 러너 사용(QEMU 크로스 빌드 회피) — 이미 반영됨.
- `type=gha` 캐시(`cache-from`/`cache-to`, scope 분리) — 이미 반영됨.
- 3개 이미지가 `needs: [preflight, ci]` 로 병렬 실행되어 최장 119초(web) 로 수렴.
  구조적으로 더 줄일 여지는 크지 않다.

한 가지 비효율: **`check-agent-image-size` 가 별도 job** 이라 `build-agent` 에서
이미 push 한 이미지를 `docker pull --platform linux/arm64` 로 **다시 받는다**(17:31:11
시작, 약 18초 중 상당수가 pull). `build-agent` job 안에서 `load: true` 로 로컬에
동시에 로드하면 이 job 자체를 없애고 같은 job 내 스텝으로 흡수할 수 있다. 크기 검사가
push 를 막는 게 아니라 경고/실패만 하므로 흐름을 바꾸지 않고도 job 경계 하나(추가
러너 기동 시간 포함 약 20~30초)를 제거할 수 있다.

## 4. `deploy-prod` 가 3개 build job 을 모두 기다리는 구조

`deploy-prod` 는 `needs: [build-web, check-agent-image-size, build-audio]` 다.
`cdk deploy --all` 은 CDK 코드상 web/agent/audio 이미지의 **존재 여부를 검사하지
않고 ECR URI 문자열만 참조**하므로(`imageTag` 로 조립), 이론적으로는 이미지가
push 완료되기 전에 CloudFormation 배포를 시작해도 무방해 보일 수 있으나 —
**Lambda `DockerImageCode.fromEcr` 와 AgentCore `ContainerUri` 는 실제로 이미지가
ECR 에 존재해야 스택 업데이트가 성공**하므로 현재의 `needs` 의존은 정확하고
안전하다. 여기서 시간을 줄이려면 이미지 빌드 자체를 줄여야 한다(3절 참고).

## 5. `smoke-test` 는 이미 가볍다

11초로 전체의 2% 미만. 개선 불필요.

## 개선 제안 (우선순위 순)

1. **`deploy.yml` 의 `ci` 재검증에서 E2E 를 제외**하거나, main 브랜치 보호 규칙
   (필수 상태 체크 + 머지 큐)으로 "머지된 코드는 이미 검증됨"을 보장해 재검증 자체를
   없애는 방향을 검토한다. 후자가 근본적이지만 저장소 설정 변경이 필요해 영향 범위가
   크다. 전자(E2E 제외)만 적용해도 약 150초(전체의 25%) 절감된다.
   - 절충안: `deploy.yml` 의 재검증은 `lint/typecheck/test/build` 4개만 재사용 호출하고,
     E2E 는 PR 단계 전용으로 분리(`ci.yml` 에서 `push: branches: [main]` 트리거 시엔
     스킵).
2. **`check-agent-image-size` 를 `build-agent` job 내부 스텝으로 흡수**한다.
   `build-agent` 의 `build-push-action` 에 `load: true` 를 추가해 로컬에도 이미지를
   남기고, 같은 job 안에서 `check-agent-image-size.sh` 를 실행하면 별도 job 의
   러너 기동 시간(약 10~15초)과 재 `docker pull`(약 5~10초)을 제거할 수 있다.
3. **`npm ci` 반복 비용**은 지금 구조에서 근본적으로 줄이기 어렵다(각 job 이 독립
   러너이므로 파일시스템을 공유하지 않는다). GitHub Actions 캐시를 노드 모듈 디렉토리
   자체(`node_modules`)로 확장하는 것은 lockfile 해시 키로 관리 가능하지만, 워크스페이스
   3개(app/agent/infrastructure)를 함께 캐싱해야 하고 캐시 미스 시 오히려 느려질 수
   있어 효과 대비 리스크가 크다. 우선순위 낮음.
4. **CI 병렬 job 배치를 손보면 소폭 이득**: 현재 `build`·`e2e` 가 `needs: [lint,
   typecheck, test]` 를 기다렸다가 시작한다(17:27:2x 시작). `lint`/`typecheck` 는
   `build`/`e2e` 의 전제조건이 아니므로(타입 에러가 있어도 Next.js 빌드 자체는
   시도할 수 있음) `needs` 를 `test` 만으로 줄이면 병렬성이 늘어난다. 다만 "타입
   에러가 있는 코드로 빌드/E2E 를 낭비적으로 도는" 트레이드오프가 있어 팀 판단이
   필요하다.

가장 확실하고 리스크가 작은 조치는 **1번(E2E 재검증 제외)** 과 **2번(이미지 크기
검사 job 흡수)** 이다. 둘을 합치면 전체 파이프라인을 10분 4초 → 약 7분대로
줄일 수 있을 것으로 추정된다(E2E 150초 + job 흡수 15~25초 절감, 병렬 구조상
정확한 총합 감소분은 재측정 필요).

## 다음 조치

- [ ] `deploy.yml` 재검증에서 E2E 제외 여부 결정 (또는 브랜치 보호 규칙 도입 검토)
- [ ] `check-agent-image-size` 를 `build-agent` job 내부로 흡수
- [ ] 조치 적용 후 실제 소요시간 재측정하여 개선폭 확인
