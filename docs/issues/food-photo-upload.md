# 음식 사진 업로드 기능

## 목적

와인과 곁들인 음식 사진을 시음 기록에 추가한다.
등록(`/record`) 단계가 아니라, 분석이 완료된 시음 상세 페이지에서 편집자가 사후 추가한다.
사진만 저장하며 별도의 AI 분석은 수행하지 않는다.

## 요구사항

- 시음 상세 페이지에서 음식 사진을 추가·삭제할 수 있다 (편집자만).
- 최대 8장까지 허용한다.
- 별도 분석(라벨 인식·보강 등)은 없다. 순수 이미지 저장·표시만.
- HEIC 촬영 사진은 기존 라벨 업로드와 동일하게 JPEG 변환 후 업로드한다.
- 라벨 사진(메인)보다 부각되지 않도록 배치·크기를 제한한다.
- 음식 사진이 없으면 열람자에게 아무것도 보이지 않아야 한다(ugly하지 않게).

## 설계

### 1. 스키마 (`packages/schemas/src`)

**common.ts** — `MEDIA_KEY_PREFIX`에 `food` 추가:
```ts
export const MEDIA_KEY_PREFIX = {
  labels: 'labels/',
  recordings: 'recordings/',
  food: 'food/',
} as const;
```

**tasting.ts** — `Tasting` 스키마에 optional 배열 필드 추가:
```ts
foodImageKeys: z.array(z.string().min(1).max(512)).max(8).optional(),
```

하위호환이므로 `CURRENT_SCHEMA_VERSION` 유지, upcast 불필요.

### 2. 업로드 흐름

기존 라벨 업로드와 동일한 패턴:
1. 클라이언트: `prepareLabelImage(file)` 재사용 → HEIC 변환·축소
2. 클라이언트 → `POST /api/tastings/[id]/food-photos` (presign 요청)
3. 서버: `presignFoodImageUpload` → S3 사전 서명 URL 발급 (`food/<uuid>.jpg`)
4. 클라이언트 → S3에 직접 PUT (사전 서명 URL)
5. 클라이언트 → `PATCH /api/tastings/[id]/food-photos` (키 등록 confirm)
6. 서버: `foodImageKeys` 배열에 append + rev 검증

**presign.ts** 추가:
- `buildFoodImageKey(imageId, extension)` → `food/<imageId>.<ext>`
- `presignFoodImageUpload({contentType})` — 라벨과 동일, 프리픽스만 다름

**services/tastings.ts** 추가:
- `addFoodPhoto(repo, tastingId, rev, imageKey)` — 배열에 추가, 8장 상한 검증
- `removeFoodPhoto(repo, tastingId, rev, imageKey)` — 배열에서 제거

### 3. API — `app/api/tastings/[id]/food-photos/route.ts`

모든 메서드에 **편집자 가드** 적용.

| 메서드 | 역할 | 요청 body | 응답 |
|--------|------|-----------|------|
| POST | presign 발급 | `{contentType, sizeBytes}` | `{imageKey, uploadUrl, expiresInSec}` |
| PATCH | 키 등록 | `{imageKey, rev}` | `{tasting}` |
| DELETE | 키 제거 | `{imageKey, rev}` | `{tasting}` |

S3 원본 삭제는 앱 범위 밖(기존 `deleteTasting` 정책과 동일).

### 4. 상세 페이지 UI

**배치** (페이지 하단, "이 와인의 과거 기록" 바로 위):
```
헤더 (와인명·평점·편집컨트롤)
라벨 사진 (320px, 메인)
분석 결과 (요약·하이라이트·5축·감정 등)
와인 정보 카드
── 곁들인 음식 (96px 썸네일 그리드) ← 여기
이 와인의 과거 기록
```

**빈 상태 처리:**
| 조건 | 렌더링 |
|------|--------|
| 사진 0장 + 열람자 | 섹션 미렌더 (아무것도 없음) |
| 사진 0장 + 편집자 | "📷 음식 사진 추가" 텍스트 버튼만 (제목·경계선 없이) |
| 사진 1장+ + 열람자 | "곁들인 음식" 소제목 + 96px 썸네일 그리드 |
| 사진 1장+ + 편집자 | 위 + 그리드 끝에 추가 버튼 + 각 사진에 삭제 아이콘 |

**컴포넌트:** `components/tasting/FoodPhotos.tsx` (클라이언트 컴포넌트)
- `next/image unoptimized` + `mediaUrl()` 사용 (기존 라벨 사진과 동일, pitfalls.md 준수)
- 썸네일 96×96, `object-cover`, `rounded-lg`
- 사진 클릭 시 원본 크기로 보기 (새 탭 `window.open`)

### 5. 인프라

변경 없음:
- `food/` 프리픽스는 S3 이벤트 알림 대상이 아님 (라벨과 동일)
- CORS·CloudFront·미디어 서빙(`/media/*`) 모두 기존 규칙으로 동작
- `/media/food/xxx.jpg` → CloudFront Function이 `food/xxx.jpg`로 변환 → S3 서빙

### 6. 테스트

- `__tests__/schemas/`: `foodImageKeys` conformance (0장·8장·9장 거부)
- `__tests__/upload/media-key-contract.test.ts`: `MEDIA_KEY_PREFIX.food` 추가
- `__tests__/api/`: food-photos 라우트 (가드 401, rev 충돌, 8장 상한)
- `__tests__/services/`: `addFoodPhoto` / `removeFoodPhoto`
- `__tests__/components/`: `FoodPhotos.tsx` 렌더링 (0장·N장·편집자·열람자)
- `e2e/auth-write-guard.spec.ts`: 새 쓰기 엔드포인트 단정 추가

## 비고

- `prepareLabelImage` 함수를 재사용하되, 함수명이 label 전용인 만큼 필요시 범용 이름으로 추출 가능 (이번에는 재사용만 하고 리네임은 하지 않음).
- S3 원본 정리는 시음 삭제 시에도 앱 범위 밖이므로 일관성 유지. 향후 lifecycle 정책으로 처리.
