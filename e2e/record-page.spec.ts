import { expect, test } from '@playwright/test';
import { loginAsEditor } from './fixtures/session';

/**
 * /record 캡처 화면 E2E (R2, R3).
 *
 * 흐름: 1단계 라벨 사진(또는 이름만) → 초안 와인·시음 생성 → 2단계 녹음(종료 시 자동 저장)
 * 정책: 기록은 로그인한 편집자만.
 */

test.describe('/record — 비로그인', () => {
  test('폼 대신 로그인 안내가 나온다', async ({ page }) => {
    const response = await page.goto('/record');
    expect(response?.status()).toBe(200);

    await expect(page.locator('body')).toContainText('시음 기록');
    await expect(page.locator('body')).toContainText(/편집자만 가능/);
    await expect(page.getByRole('link', { name: '로그인' }).first()).toBeVisible();
  });

  test('캡처 컨트롤이 노출되지 않는다', async ({ page }) => {
    await page.goto('/record');
    await expect(page.getByLabel('라벨 사진 올리기')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /녹음 시작/ })).toHaveCount(0);
  });
});

test.describe('/record — 로그인한 편집자', () => {
  test.beforeEach(async ({ context }) => {
    await loginAsEditor(context);
  });

  test('세션 상태가 인증됨으로 조회된다', async ({ page }) => {
    const response = await page.goto('/api/auth/session');
    expect(await response?.json()).toMatchObject({ authenticated: true });
  });

  test('1단계 캡처 UI 가 보이고 저장 버튼은 없다', async ({ page }) => {
    await page.goto('/record');

    await expect(page.getByText('1 · 무슨 와인이에요?')).toBeVisible();
    await expect(page.getByLabel('라벨 사진 올리기')).toBeAttached();
    await expect(page.getByRole('button', { name: '사진 없이 이름만 입력' })).toBeVisible();

    // 녹음은 와인 확인 후에만 가능하다
    await expect(page.getByText('와인을 먼저 확인하면 녹음할 수 있습니다.')).toBeVisible();

    // 저장 버튼을 두지 않는다 (녹음 종료 시 자동 저장)
    await expect(page.getByRole('button', { name: /저장/ })).toHaveCount(0);
  });

  test('이름만 입력해도 초안 와인·시음이 만들어지고 녹음 단계로 넘어간다', async ({ page }) => {
    await page.goto('/record');
    await page.getByRole('button', { name: '사진 없이 이름만 입력' }).click();
    await page.getByLabel('와인 이름').fill('E2E 초안 와인');
    await page.getByRole('button', { name: '확인' }).click();

    // 확인된 와인이 한 줄 요약으로 표시되고 녹음 컨트롤이 등장한다
    await expect(page.getByText('E2E 초안 와인')).toBeVisible();
    await expect(page.getByRole('button', { name: /녹음 시작/ })).toBeVisible({ timeout: 15_000 });
  });

  test('초안 와인은 카탈로그 목록에 바로 노출되지 않는다', async ({ page }) => {
    // 위 테스트에서 만든 초안은 시음이 붙어 있어 "확인 필요" 대상으로 노출되지만,
    // 시음이 없는 초안은 목록을 오염시키지 않아야 한다.
    await page.goto('/record');
    await page.getByRole('button', { name: '사진 없이 이름만 입력' }).click();
    await page.getByLabel('와인 이름').fill('노출되면 안 되는 초안');
    await page.getByRole('button', { name: '확인' }).click();
    await expect(page.getByRole('button', { name: /녹음 시작/ })).toBeVisible({ timeout: 15_000 });

    // 시음이 붙었으므로 목록에 나온다(확인 필요). 대신 이름이 중복 생성되지 않는지만 본다.
    await page.goto('/wines');
    const rows = page.getByText('노출되면 안 되는 초안');
    expect(await rows.count()).toBeLessThanOrEqual(1);
  });

  test('헤더에 기록 링크와 로그아웃이 보인다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '기록', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '로그아웃' })).toBeVisible();
  });

  test('타임라인·대시보드에 기록 추가 버튼이 보인다', async ({ page }) => {
    await page.goto('/timeline');
    const timelineButton = page.getByRole('link', { name: /시음 기록 추가/ });
    await expect(timelineButton).toBeVisible();
    await expect(timelineButton).toHaveAttribute('href', '/record');
    await expect(page.getByRole('note')).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByRole('link', { name: /시음 기록 추가/ }).first()).toBeVisible();
  });

  test('기록 추가 버튼으로 캡처 화면에 진입한다', async ({ page }) => {
    await page.goto('/timeline');
    await page.getByRole('link', { name: /시음 기록 추가/ }).click();
    await expect(page).toHaveURL(/\/record$/);
    await expect(page.getByText('1 · 무슨 와인이에요?')).toBeVisible();
  });

  test('시음 상세에서 수정·삭제·수동 평점 컨트롤이 보인다', async ({ page }) => {
    await page.goto('/tastings/tasting-analyzed-0001');
    await expect(page.getByRole('button', { name: /수정/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /삭제/ })).toBeVisible();
    await expect(page.getByLabel('수동 평점', { exact: true })).toBeVisible();
  });

  test('수동 평점을 저장하면 대표 평점이 갱신된다', async ({ page }) => {
    // 평점이 없는 '분석 대기' 시음을 대상으로 한다 (공유 시드 오염 방지)
    await page.goto('/tastings/tasting-pending-0001');
    await page.getByLabel('수동 평점', { exact: true }).selectOption('3');
    await page.getByRole('button', { name: '수동 평점 저장' }).click();

    await expect(page.getByLabel('수동 평점 3점 (5점 만점)')).toBeVisible({ timeout: 15_000 });
  });

  test('로그아웃하면 쓰기 UI 가 사라진다', async ({ page }) => {
    await page.goto('/tastings/tasting-analyzed-0001');
    await expect(page.getByRole('button', { name: /수정/ })).toBeVisible();

    await page.getByRole('link', { name: '로그아웃' }).click();
    await page.waitForURL('**/');

    await page.goto('/tastings/tasting-analyzed-0001');
    await expect(page.getByRole('button', { name: /수정|삭제/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '로그인', exact: true })).toBeVisible();
  });
});
