# AgentCore Web Search Tool 전환 검토

- 상태: 보류
- 날짜: 2025-08-05
- 관련: `lib/agent/labelEnrich.ts`, `pitfalls.md` (유료 API 통제 규칙)

## 배경

Amazon Bedrock AgentCore에 **Web Search Tool**이 2026-06 GA로 출시됐다.
현재 와인 라벨 보강(`labelEnrich.ts`)은 SerpAPI를 사용하며 월 100회 무료 티어 제약이 있다.
AgentCore Web Search로 교체 가능한지 검토한다.

## AgentCore Web Search Tool 개요

- AgentCore Gateway의 managed connector target (MCP 호환)
- Amazon 자체 웹 인덱스 사용 (외부 검색 엔진 API 불요)
- 입력: 자연어 쿼리
- 출력: 관련 스니펫, 소스 URL, 제목, 게시일
- 시맨틱 스니펫 추출 + knowledge graph 지원
- AWS 내부 경로로 처리 (외부 네트워크 호출 없음)

## 장점

| 항목 | 설명 |
|---|---|
| 무료 티어 제약 해소 | SerpAPI 월 100회 제한 없어짐. AWS 종량제 |
| 인프라 단순화 | 외부 API 키(`SERPAPI_KEY`) 관리 불요. IAM 통합 |
| 네트워크 경로 축소 | AWS 내부 처리, 외부 API 대비 레이턴시·장애점 감소 |
| MCP 호환 | Strands Agent가 MCP 도구로 자연스럽게 호출 가능 |
| 콘텐츠 품질 | 시맨틱 추출 + knowledge graph — 와인 정보에 적합할 수 있음 |

## 단점

| 항목 | 설명 |
|---|---|
| 아키텍처 변경 | 현재 Runtime 컨테이너 직접 실행 구조에 Gateway 배선 추가 필요 |
| 상시 비용 위험 | Gateway 자체가 상시 과금인지 확인 필요 (정책: "상시 과금 리소스 금지") |
| 통제력 감소 | MCP 도구로 노출 시 모델이 자율적으로 여러 번 호출할 위험 (pitfalls 위반) |
| 파싱 로직 수정 | `labelEnrich.ts`가 SerpAPI 응답 구조에 맞춰져 있음 |
| 가격 불투명 | GA 직후라 프리티어 범위·단가 확인 필요 |
| Region 제약 | ap-northeast-2 가용 여부 확인 필요 |

## 핵심 제약: 검색 통제 정책

pitfalls.md 규칙:

> 유료 API 호출을 모델 자율 판단(도구)에 맡기지 않는다.
> 검색은 빈 필드가 있을 때만 코드가 한 번 부르도록 통제한다.

이 규칙은 도구 교체와 무관하게 유지해야 한다. 도입 시 두 가지 방식:

1. **Gateway MCP 도구로 에이전트에 노출** → 정책 위반 위험 (모델 자율 호출)
2. **`labelEnrich.ts`에서 코드가 직접 API 호출** → 정책 준수, Gateway 없이 직접 호출 가능한지 확인 필요

## 판단

- 현재 SerpAPI 100회/월이 실제로 부족한 상황이 아님
- 아키텍처 복잡도(Gateway 추가) 대비 이득이 크지 않음
- Gateway 상시 비용이 발생하면 정책 위반
- **결론: 현 시점에서는 전환하지 않는다**

## 재검토 조건

- SerpAPI 무료 티어가 실제로 부족해지는 경우 (월 사용량 모니터링)
- AgentCore Gateway를 다른 이유로 도입하게 되는 경우 (추가 비용 0)
- Web Search API가 Gateway 없이 직접 호출 가능해지는 경우
- ap-northeast-2 가용 + 프리티어 범위 확인 시
