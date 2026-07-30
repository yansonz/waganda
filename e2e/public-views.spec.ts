import { expect, test } from '@playwright/test';

/**
 * 공개 열람 뷰 E2E (R9).
 *
 * DynamoDB Local 에 넣은 **스키마 검증을 통과한 시드 데이터**가 실제로 화면에
 * 나타나는지 확인한다. 상태 코드와 시드 콘텐츠를 모두 단정한다 —
 * "렌더만 되면 통과" 하는 느슨한 단정은 데이터 경로 결함을 놓친다.
 */

const SEED_WINE_NAME = 'Château Margaux 2015';
const SEED_SECOND_WINE_NAME = 'Cloudy Bay Sauvignon Blanc';
const SEED_DISCOVERY_ALIAS = '보르도 몰아보기의 법칙';

test.describe('공개 열람 뷰', () => {
  test('대시보드가 200 이고 최근 시음의 와인 이름이 보인다', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(SEED_WINE_NAME);
  });

  test('와인 목록에 시드 와인 2종이 모두 나온다', async ({ page }) => {
    const response = await page.goto('/wines');
    expect(response?.status()).toBe(200);
    const body = page.locator('body');
    await expect(body).toContainText(SEED_WINE_NAME);
    await expect(body).toContainText(SEED_SECOND_WINE_NAME);
  });

  test('타임라인이 200 이고 시음 기록이 보인다', async ({ page }) => {
    const response = await page.goto('/timeline');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(SEED_WINE_NAME);
  });

  test('랭킹이 200 이고 평점이 있는 와인이 보인다', async ({ page }) => {
    const response = await page.goto('/rankings');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(SEED_WINE_NAME);
    // AI/수동을 나누지 않고 최종 평점 하나로 줄을 세운다 → 기준 선택 컨트롤이 없다
    await expect(page.getByRole('group', { name: '평점 기준 선택' })).toHaveCount(0);
  });

  test('헤더에 탐색 탭을 두지 않는다', async ({ page }) => {
    await page.goto('/timeline');
    const nav = page.getByRole('navigation', { name: '주요 메뉴' });
    await expect(nav.locator('a[href="/explore"]')).toHaveCount(0);
    await expect(nav.locator('a[href="/rankings"]')).toHaveCount(1);
  });

  test('발견 카드 목록에 별칭과 우연 가능성 문구가 함께 나온다', async ({ page }) => {
    const response = await page.goto('/discoveries');
    expect(response?.status()).toBe(200);
    const body = page.locator('body');
    await expect(body).toContainText(SEED_DISCOVERY_ALIAS);
    // R8: 모든 카드에 우연 가능성 문구를 함께 표시한다
    await expect(body).toContainText(/우연/);
  });

  test('지역 계층 탐색에서 국가가 보이고 하위로 내려갈 수 있다', async ({ page }) => {
    const response = await page.goto('/explore');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText('프랑스');
  });

  test('타임라인의 시음 링크로 상세 화면에 진입할 수 있다', async ({ page }) => {
    await page.goto('/timeline');
    const detailLink = page.locator('a[href^="/tastings/"]').first();
    await expect(detailLink).toBeVisible();
    await detailLink.click();
    await expect(page).toHaveURL(/\/tastings\//);
  });

  test('분석이 완료된 시음 상세에 요약·하이라이트·근거가 보인다', async ({ page }) => {
    // 최신순 목록의 첫 항목은 분석 대기 시음이므로 완료 건을 직접 연다.
    const response = await page.goto('/tastings/tasting-analyzed-0001');
    expect(response?.status()).toBe(200);

    const body = page.locator('body');
    await expect(body).toContainText(SEED_WINE_NAME);
    // 시드 분석 결과의 요약·하이라이트 문구 (R6: 근거를 동반한 서술)
    await expect(body).toContainText(/검은 과실/);
    await expect(body).toContainText(/향이 진짜 좋다/);
  });

  test('분석 대기 중인 시음 상세는 오류 없이 대기 상태를 보여준다', async ({ page }) => {
    const response = await page.goto('/tastings/tasting-pending-0001');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/분석/);
  });

  test('평점은 하나만 보여준다 — 수동 평점이 있으면 수동 값이 표시된다', async ({ page }) => {
    // 시드: 수동 4.5 / AI 3.5
    await page.goto('/tastings/tasting-analyzed-0001');

    // 수동 평점이 대표 평점으로 표시된다 (출처가 접근성 이름에 포함)
    await expect(page.getByLabel('수동 평점 4.5점 (5점 만점)')).toBeVisible();

    // AI 평점(3.5)은 대표 평점으로 노출되지 않는다 — 값은 보존되지만 표시는 하나만.
    // (5축 노트에도 3.5 가 나오므로 본문 문자열이 아니라 평점 위젯으로 단정한다)
    await expect(page.getByLabel('AI 평점 3.5점 (5점 만점)')).toHaveCount(0);
    await expect(page.getByLabel(/AI 평점 .*점 \(5점 만점\)/)).toHaveCount(0);
  });

  test('목록 화면도 같은 대표 평점을 쓴다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel(/수동 평점 4\.5점/).first()).toBeVisible();
    await expect(page.getByLabel(/AI 평점 3\.5점/)).toHaveCount(0);
  });

  test('비로그인 방문자에게는 수동 평점 입력 컨트롤이 보이지 않는다', async ({ page }) => {
    // 정책: 로그인해야 쓰기 UI 가 보인다. 표시된 대표 평점은 그대로 열람 가능하다.
    await page.goto('/tastings/tasting-analyzed-0001');
    await expect(page.getByLabel('수동 평점 4.5점 (5점 만점)')).toBeVisible();
    await expect(page.getByLabel('수동 평점', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '수동 평점 저장' })).toHaveCount(0);
  });

  test('와인 상세에서 시음 이력이 보인다', async ({ page }) => {
    await page.goto('/wines');
    const wineLink = page.locator('a[href^="/wines/"]').first();
    await expect(wineLink).toBeVisible();
    await wineLink.click();

    await expect(page).toHaveURL(/\/wines\//);
    await expect(page.locator('body')).toContainText(/시음|기록/);
  });

  test('존재하지 않는 시음 상세는 404 를 반환한다 (오류 화면이 아니다)', async ({ page }) => {
    const response = await page.goto('/tastings/does-not-exist-0000');
    expect(response?.status()).toBe(404);
  });

  test('robots.txt 가 인증·쓰기 경로를 크롤링에서 제외한다', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('/api/auth');
    expect(text).toContain('/record');
  });
});
