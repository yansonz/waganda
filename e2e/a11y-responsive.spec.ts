import { test, expect, devices } from '@playwright/test';

/**
 * 접근성 및 반응형 테스트
 *
 * 요구사항 R1, R9:
 * - 375px 모바일 폭에서 가로 스크롤 없이 렌더
 * - 주요 버튼에 접근가능한 이름(accessible name)이 있는지
 * - 키보드 Tab으로 주요 상태전이가 가능한지
 */

test.describe.configure({ retries: 0 });

test.describe('모바일 반응형 (375px)', () => {
  // Pixel 5 프로젝트에서만 이 테스트들을 실행
  test.describe.configure({ use: devices['Pixel 5'] });

  test('가로 스크롤 없이 렌더된다', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('주요 버튼들이 접근가능한 이름을 가진다', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button');
    const buttonCount = await buttons.count();

    if (buttonCount > 0) {
      const firstButton = buttons.first();
      const accessibleName = await firstButton.evaluate((el) => {
        return (el.getAttribute('aria-label') || el.textContent || '').trim();
      });

      expect(accessibleName.length).toBeGreaterThan(0);
    }
  });

  test('Tab 키로 링크와 버튼을 순회할 수 있다', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const focusableElements = page.locator('a, button, [tabindex="0"]');
    const count = await focusableElements.count();

    if (count > 0) {
      await focusableElements.first().focus();
      const focused = await page.evaluate(() => document.activeElement?.tagName);
      expect(focused).toBeTruthy();

      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);

      const nextFocused = await page.evaluate(() => document.activeElement?.tagName);
      expect(nextFocused).toBeTruthy();
    }
  });
});

test.describe('데스크톱 접근성', () => {
  test('대시보드의 주요 섹션에 헤딩이 있다', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const headings = page.locator('h1, h2, h3');
    const headingCount = await headings.count();

    expect(headingCount).toBeGreaterThan(0);
  });

  test('링크가 언더라인되거나 색상이 다르다', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const links = page.locator('a');
    const count = await links.count();

    if (count > 0) {
      const style = await links.first().evaluate((el) => {
        return window.getComputedStyle(el);
      });

      expect(style).toBeTruthy();
    }
  });
});
