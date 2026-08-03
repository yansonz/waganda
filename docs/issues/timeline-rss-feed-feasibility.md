# 타임라인 RSS 피드 제공 가능성 검토

> 기준일: 2026-07-31 (검토) / 2026-08-03 (구현 완료)
> 범위: `app/(public)/timeline/page.tsx`, `lib/views/read.ts`, `lib/config.ts`,
> `infrastructure/lib/web-stack.ts`, `app/robots.ts`.

## 구현 완료 (2026-08-03)

검토에서 확정된 결정 사항대로 구현했다.

- `lib/rss.ts` — XML 이스케이프(`escapeXml`)와 RSS 2.0 문서 조립(`buildRssFeed`)을
  순수 함수로 분리. `<item><guid isPermaLink="false">` 로 `tastingId` 를 안정 식별자로 씀.
- `app/feed.xml/route.ts` — `GET` 핸들러. `getTimelineView(repo)` 로 최신순 조회 후
  **상위 50개만** 잘라 피드에 넣는다(`FEED_ITEM_LIMIT`). `export const dynamic = 'force-dynamic'`.
  응답은 `Content-Type: application/rss+xml; charset=utf-8`.
- `app/sitemap.ts` — `robots.ts` 가 이미 참조하던 `sitemap.xml` 을 실제로 채웠다.
  정적 경로(`/`, `/timeline`, `/wines`, `/discoveries`, `/rankings`, `/explore`) +
  동적 경로(`/tastings/[id]`, `/wines/[id]`, `/wineries/[id]`) 전체를 포함.
- `<enclosure>`(라벨 사진)는 결정대로 **미포함**.
- 캐시 무효화 관련 별도 배선은 **하지 않음** — 아래 캐시 절에서 확인한 대로
  기존 `/*` 무효화 로직에 `/feed.xml`·`/sitemap.xml` 이 이미 자동으로 포함되기 때문.

### 테스트

- `__tests__/lib/rss.test.ts` (9건) — 이스케이프, guid, pubDate(RFC1123), vintage 유무별
  title 조합, XSS 스타일 텍스트 이스케이프, 다건 item 렌더링을 검증.
- `__tests__/api/feed-sitemap.test.ts` (2건) — `setDocClient` 로 DynamoDB 를 스텁해
  레코드 0건 상태에서 두 라우트가 예외 없이 유효한 형식으로 응답하는지 스모크 테스트.
  (데이터가 있는 조합 로직은 위 rss.test.ts 와 기존 `__tests__/views/read.test.ts` 가 고정.)

### 검증 결과

- `npx tsc --noEmit` — 0 에러.
- `npx eslint .` — 0 에러.
- `npm test` — 78 파일 / 700건 전체 통과(신규 2개 파일 11건 포함).

배포 후 실제 확인이 필요한 항목(로컬 검증 불가, 위 "확인이 필요한 지점" 참고):
CloudFront 캐시 히트 시에도 `Content-Type: application/rss+xml` 이 유지되는지
`curl -I <baseUrl>/feed.xml` 로 점검.

## 결론

**가능하다.** 필요한 데이터·URL 헬퍼가 이미 존재하고, Next.js App Router 의 라우트
핸들러로 XML 을 직접 응답할 수 있다. CloudFront 캐시 정책도 기본 동작(defaultBehavior)이
`/*` 를 포괄하므로 별도 인프라 변경 없이 캐시된다. 단, 몇 가지 확인·결정이 필요한 지점이 있다.

## 데이터 소스

`getTimelineView(repo)` (`lib/views/read.ts:520`)가 최신순 `TastingSummaryView[]` 를
반환하며, RSS 아이템에 바로 쓸 수 있는 필드를 이미 갖고 있다.

```ts
export interface TastingSummaryView {
  tastingId: string;
  wineId: string;
  wineName: string;
  vintage?: number;
  tastedAt: string;       // RSS <pubDate> 로 변환
  displayRating?: number; // 수동 우선, 없으면 AI (product.md 정책과 일치)
  ratingSource?: 'manual' | 'ai';
  summary?: string;       // <description> 후보 (AI 요약, 편집됐으면 editedSummary)
  labelImageKey?: string; // <enclosure> 후보 — CloudFront 미디어 경로로 변환 필요
  agreementScore?: number;
}
```

- `tastingId` → 상세 페이지 링크는 `/tastings/${tastingId}` (`TastingCard.tsx` 와 동일 패턴).
- `wineName` + `vintage` → `<title>` 조합에 사용 가능.
- 공개 정책과 충돌 없음: RSS 에 노출할 필드(`summary`, `displayRating`, `wineName`)는 이미
  타임라인 화면에 공개된 값이고, product.md 가 금지한 "녹음 원본·전사문"은 애초에
  `TastingSummaryView` 에 포함돼 있지 않다.

## URL 생성

`lib/config.ts` 의 `absoluteUrl()` / `getPublicBaseUrl()` 을 그대로 재사용할 수 있다.

- `absoluteUrl()` 은 `APP_BASE_URL` 런타임 설정 기준으로 절대 URL 을 만든다
  (`request.nextUrl.origin` 을 쓰지 않는 이유는 pitfalls.md 인증 항목과 동일 — CloudFront 가
  `host` 헤더를 오리진에 전달하지 않아 컨테이너 내부 주소로 계산될 위험).
- `getPublicBaseUrl()` 은 빌드 시점(정적 생성)에도 안전하게 평가되는 표기용 버전이다.
  `robots.ts` 가 이미 이 함수로 `sitemap` 필드를 채우고 있어 동일 패턴을 따르면 된다.

## 구현 방식 — Next.js Route Handler

App Router 는 메타데이터 라우트 파일(`sitemap.ts`, `robots.ts`)과 별개로, 일반
라우트 핸들러(`route.ts`)에서 임의의 `Content-Type` 응답을 만들 수 있다. RSS 는
전용 컨벤션 파일이 없으므로 route handler 로 구현한다.

```
app/feed.xml/route.ts   또는   app/(public)/timeline/feed.xml/route.ts
```

- `export const dynamic = 'force-dynamic'` — 타임라인 페이지와 동일하게 매 요청 시
  최신 데이터를 반영하되, CloudFront 캐시가 부하를 흡수한다(아래 캐시 절 참고).
- 응답은 `new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } })`.
- RSS 2.0 스펙 준수 최소 구조: `<rss><channel><title/><link/><description/><item>...`.
  `<item><guid isPermaLink="false">{tastingId}</guid>` 로 안정적 식별자를 준다
  (URL 구조가 바뀌어도 피드 리더가 중복 처리하지 않도록).
- XML 이스케이핑: `wineName`, `summary` 는 사용자/모델 생성 텍스트이므로 `&`, `<`, `>`
  등을 반드시 이스케이프해야 한다. 기존 코드베이스에 XML 빌더가 없으므로 직접 이스케이프
  함수를 작성하거나 검증된 최소 의존성(예: 표준 라이브러리 수준의 escape) 사용을 검토.

## 캐시 (CloudFront)

`infrastructure/lib/web-stack.ts` 의 `defaultBehavior` 가 `/*` 전체를 `cachePublicPages`
정책으로 처리한다(`defaultTtl: 7일`, `minTtl: 1분`, RSC 헤더/쿼리스트링 캐시 키 포함).
`/feed.xml` 은 이 패턴에 그대로 포함되므로 **추가 behavior 없이 캐시된다.**

확인이 필요한 지점:

- `cachePublicPages` 의 헤더 캐시 키가 `RSC`·`Next-Router-Prefetch` 만 허용하므로
  RSS 요청(일반 GET, 해당 헤더 없음)은 기본 캐시 키로 정상 캐시될 것으로 예상되나,
  실제 배포 후 `curl -I <baseUrl>/feed.xml` 로 `Content-Type: application/rss+xml` 이
  캐시 히트 시에도 유지되는지 확인 필요(pitfalls.md 의 RSC 캐시 키 함정과 유사한 종류의
  검증이 요구되는 지점).

**갱신 지연 문제는 이미 해결되어 있다(추가 코드 불필요).** 기존 무효화 로직이 전 경로
패턴(`/*`)을 쓰므로 `/feed.xml` 도 자동으로 포함된다:

- `lib/cache/invalidate.ts` 의 `invalidateCache()` — 편집자 쓰기 API
  (`PATCH`/`DELETE /api/tastings/[id]` 등)가 성공하면 호출되고, `paths: ['/*']` 로
  CloudFront 전체를 무효화한다.
- `agent/src/graph/nodes/persistAndPublish.ts` — 분석 파이프라인(세션 B) 마지막 노드.
  소믈리에 분석 결과를 DynamoDB 에 쓴 직후 **별도 CloudFront 클라이언트**로 동일하게
  `Paths: { Items: ['/*'] }` 무효화를 발행한다. 새 시음 기록이 확정되는 시점이 바로 여기다.

두 지점 모두 경로를 개별 지정하지 않고 `/*` 전체를 지우므로, `/feed.xml` 을 만들면
**별도 배선 없이** 새 시음 확정·편집자 쓰기 직후 캐시가 즉시 비워지고 다음 요청부터
최신 데이터로 채워진다. design.md 가 이 방식을 고른 이유(월 1,000경로 무료 한도, 쓰기
빈도가 낮음)도 그대로 적용된다 — 무효화 대상이 하나 늘었다고 비용이나 빈도 문제가
생기지 않는다.

## 남은 결정 사항 (구현 착수 전)

1. 피드 URL 경로: `/feed.xml` (루트, 사이트 전체 피드 성격) vs `/timeline/feed.xml`
   (타임라인 전용). 현재 공개 피드 소스가 타임라인 하나뿐이라 실질적 차이는 없음. -> 루트로 진행
2. 아이템 개수 제한: 전체 히스토리를 다 넣을지, 최근 N개(예: 50개)로 자를지. -> 상위 50개
3. `<enclosure>` 로 라벨 사진을 넣을지 여부. 넣는다면 `labelImageKey` 를
   `/media/${labelImageKey}` 형태의 CloudFront 경로로 변환해야 한다
   (pitfalls.md "CloudFront 는 요청 경로를 그대로 S3 키로 쓴다" — `/media` 접두어 필수). -> 미진행
4. `robots.ts` 가 이미 `sitemap: ${baseUrl}/sitemap.xml` 을 참조하지만 실제
   `app/sitemap.ts` 파일은 코드베이스에 존재하지 않는다(`glob` 결과 0건). RSS 피드
   작업과 별개 이슈이나, 함께 발견했으므로 기록. sitemap 도 없이 robots.txt 가
   깨진 링크를 광고하는 상태다. -> 완료(`app/sitemap.ts` 구현, 위 "구현 완료" 절 참고)

## 영향 없는 부분 (확인됨)

- DynamoDB·S3 접근 계층 변경 불필요 — 기존 `Repository`/`getTimelineView` 재사용.
- 인증·편집자 가드 무관 — RSS 는 읽기 전용 공개 엔드포인트이므로
  `structure.md` 의 "쓰기 라우트는 편집자 가드 통과" 규칙과 무관.
- 상시 과금 리소스 추가 없음 — route handler 는 기존 Lambda(web) 안에서 처리되고
  CloudFront 캐시 정책도 기존 정책을 재사용한다.
