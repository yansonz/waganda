# 인프라 적정성·비용·보안 점검 — serverless 원칙 준수 여부

> 기준일: 2026-07-31
> 범위: `infrastructure/` 4개 스택(data/web/pipeline/ops) 코드, `infrastructure/test/`,
> `.github/workflows/*.yml`, `waganda` 프로필로 조회한 실제 배포 리소스(계정 480174684407,
> ap-northeast-2). 구현 변경은 없다.

## 요약

| 항목 | 판단 | 근거 |
| --- | --- | --- |
| Serverless 원칙 | **계획대로 진행됨** | `no-always-on-cost.test.ts` 가 19종 상시과금 리소스 타입 금지를 단정하고, 실배포도 이와 일치. VPC 자체가 없음 |
| IAM 최소권한 / OAC / OIDC | **양호** | 리소스 ARN 단위 권한, 이중 서명(OAC), GitHub 저장소 불변 ID 기반 신뢰 조건 |
| 시크릿 관리 | **양호** | SSM SecureString 은 CDK 가 생성하지 않고 사전 CLI 생성. Runtime 환경변수에 평문 시크릿 없음 |
| AWS Budgets 알람 (R11) | **미구현** | 코드에 주석으로만 존재. `describe-budgets` 실제 조회 결과 빈 배열 |
| CloudFront PriceClass | **기본값(All) 그대로** | 코드에 명시 없어 CDK 기본값 사용. 국내 트래픽 위주면 절감 효과는 작음 |
| 월 예상 운영비 | **약 $8~24 (1.1만~3.3만원)** | 배포 첫날이라 실측 불가, 스펙 기준 사용량으로 추정 |

## 1. Serverless 원칙 검증

### 1.1 스펙 테스트 (`infrastructure/test/no-always-on-cost.test.ts`)

유휴 시 시간당 과금되는 리소스 타입 19종(ALB, NAT Gateway, EC2, RDS, ECS, EKS, Redshift,
SageMaker Endpoint, ElastiCache, OpenSearch, MSK, DocDB, Transfer Server, Global Accelerator 등)이
dev/prod 양쪽 환경의 4개 스택 synth 결과에 **전혀 등장하지 않음**을 단정한다. 추가로:

- DynamoDB 는 `PAY_PER_REQUEST` 만 허용 (`ProvisionedThroughput` 부재 확인)
- VPC 자체를 만들지 않음
- Lambda 에 프로비저닝된 동시성 설정 없음

이 테스트는 `testing.md` steering 문서에서 "통과가 어렵다고 삭제하지 않는다(실제로 삭제됐다가
복원된 이력이 있다)"고 명시된 R11 요구사항 스펙 테스트다.

### 1.2 실제 배포 확인 (waganda 프로필)

| 리소스 | 확인 결과 |
| --- | --- |
| Lambda | 5개 — `waganda-web-prod`(컨테이너, ARM64), `waganda-trigger-upload-prod`, `waganda-trigger-transcribe-prod`, `AudioProcessorLambda`(컨테이너, ARM64), `BucketNotificationsHandler`(CDK 커스텀 리소스) |
| DynamoDB | `waganda-prod` — `BillingModeSummary.BillingMode: PAY_PER_REQUEST`, RCU/WCU 0 확인 |
| AgentCore Runtime | `waganda_agent_prod-ght6vwCNJf` — status `READY`, `NetworkMode: PUBLIC`(NAT 비용 차단), 유휴 세션 타임아웃 60초/최대 수명 900초 |
| S3 | 5개 버킷(media/sessions/static/transcribe-local + CDK 자산 버킷) |
| CloudFront | 1개 배포, `PriceClass_All`, Lambda Function URL + S3 오리진 2개, OAC 이중 서명 확인 |
| VPC/RDS/EC2/NAT/ECS/EKS | **전혀 없음** |

계획(설계 문서)과 실제 배포가 정확히 일치한다. 상시과금 리소스는 어디에도 없다.

## 2. 보안 점검

- **IAM**: 각 Lambda/AgentCore 실행 역할이 리소스 ARN 단위로 권한을 부여한다
  (`web-stack.ts`, `pipeline-stack.ts`). `web-stack.test.ts` 는 S3 버킷 정책에
  `distribution/*` 와일드카드가 아니라 실제 배포 ID 참조를 강제하는 테스트를 포함한다.
- **OAC**: S3·Lambda Function URL 오리진 모두 `SigningBehavior: always` 로 서명 필수.
  Function URL 은 `lambda:InvokeFunctionUrl` 과 `lambda:InvokeFunction` 양쪽 권한을 모두
  부여해 2025-10 이후 정책 변경에 대응했다(pitfalls.md 에 기록된 실제 장애 회피).
- **OIDC**: GitHub Actions 배포 역할의 신뢰 조건은 저장소 불변 ID
  (`yansonz@18474271/waganda@1315949219`) 기준이며, `ref:refs/heads/main` 과
  `environment:prod` 두 형태를 모두 허용한다(하나만 넣으면 배포 잡만 AccessDenied 났던
  실제 장애 이력 반영). 배포 역할은 CDK 부트스트랩 역할만 assume 하고 직접 CFN 권한을
  갖지 않아 blast radius 가 작다.
- **시크릿**: SSM SecureString 파라미터(Google OAuth, JWT secret, editor allowlist,
  SerpAPI key)는 CDK 가 생성하지 않는다 — CloudFormation 이 SecureString 을 만들 수 없기
  때문에 `infrastructure/scripts/put-secrets.sh` 로 사전에 사람이 생성한다. AgentCore
  Runtime `EnvironmentVariables` 에는 시크릿을 평문으로 넣지 않고 런타임에 SSM 에서 읽는다.

특이 취약점 없음.

## 3. 미구현 항목 — AWS Budgets 예산 알람

`ops-stack.ts` 에 다음이 **주석으로만** 존재한다:

```ts
// AWS Budgets는 CDK 네이티브 구성이 제한적이므로 주석으로 구조만 표시
// 실제 배포 시 콘솔 또는 CloudFormation 수동 추가
// 목표:
// - 월 $10 이상시 80% 알림
// - 월 $10 도달 시 100% 알림
// - 필터: Project=waganda 태그
```

`aws budgets describe-budgets --account-id 480174684407` (us-east-1) 실제 조회 결과는
빈 배열 — 콘솔에서도 CDK 외부로도 생성되지 않았다. R11 요구사항의 예산 알람 부분이
미완료 상태다. Serverless 설계 덕에 비용 폭탄 위험 자체는 낮지만, Bedrock/Transcribe
호출 버그(예: 무한 재시도)가 생겨도 알아차릴 안전망이 없다.

**권고**: `aws budgets` CLI 또는 CDK `aws-budgets` 모듈로 Project=waganda 태그 필터 예산을
실제로 생성해 R11 을 완결할 것.

## 4. CloudFront PriceClass

코드(`web-stack.ts`)에 `priceClass` 를 명시하지 않아 CDK/CloudFront 기본값인
`PriceClass_All`(전세계 엣지) 그대로 배포되어 있다. 트래픽이 국내(한국) 위주라면
`PriceClass_100`(북미·유럽) 또는 `PriceClass_200` 으로 낮춰도 체감 성능 차이는 없고
약간의 비용 절감이 가능하다. 다만 저트래픽 개인 프로젝트 규모에서는 절대 금액 차이가
크지 않아 우선순위는 낮다.

## 5. 월 예상 운영비

Cost Explorer 실측(`ce get-cost-and-usage`, 2026-07-25~31)은 배포 첫날이라 전 서비스
사실상 $0 — 참고 불가. 스펙 기준(부부 2인, 시음 기록 월 10~20건, 회당 대화 10~20분)으로
추정한 사용량 기반 비용:

| 항목 | 산정 근거 | 월 예상 (USD) |
| --- | --- | --- |
| Lambda (web + 트리거 3종) | 저트래픽, ARM64 | $0~1 |
| DynamoDB (PAY_PER_REQUEST) | 수십~수백 아이템 | $0~1 |
| S3 (미디어/세션/정적) | 녹음 파일 월 10~20건, 수백MB | $0.5~2 |
| CloudFront | PriceClass_All, 저트래픽 | $0~1 |
| Amazon Transcribe | 분당 과금, 월 200~400분 | $5~10 |
| Bedrock (추론 프로파일 3종) | 라벨 인식 + 소믈리에 분석, 월 10~20회 | $1~5 |
| AgentCore Runtime | 세션당 과금, 월 10~20세션 | $1~3 |
| CloudWatch Logs/알람/SNS | 14일 보관, 저볼륨 | $0~1 |
| Route53 | 호스팅존 1개 | $0.5 |
| **합계** | | **약 $8~24/월 (약 1.1만~3.3만원)** |

가장 비중이 큰 항목(Transcribe, Bedrock, AgentCore)은 모두 정적 인프라 비용이 아니라
실사용량에 정비례한다. "쓰지 않으면 거의 나가지 않는다"는 serverless 설계 목표가
비용 구조에도 그대로 반영되어 있다.

## 다음 조치

- [ ] AWS Budgets 알람 실제 생성 (Project=waganda 태그 필터, 월 $10~15 임계)
- [ ] (선택) CloudFront `priceClass` 를 `PriceClass_100`/`200` 으로 낮춰 소폭 절감 검토
