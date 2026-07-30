import { expect, test } from '@playwright/test';

/**
 * 인증·쓰기 가드 E2E (R1, R10).
 *
 * 핵심은 두 가지다.
 * 1) 편집 컨트롤은 **세션 유무와 무관하게 렌더링**되고, 실행 시 로그인 흐름으로 전환된다.
 * 2) 모델 호출을 유발하는 엔드포인트가 미인증 요청에 절대 열리지 않는다(비용 보호).
 */

const WRITE_ENDPOINTS = [
  { method: 'post' as const, path: '/api/wines', body: { name: '테스트 와인' } },
  {
    method: 'post' as const,
    path: '/api/tastings',
    body: { wineId: 'wine-margaux-2015', tastedAt: new Date().toISOString() },
  },
  { method: 'post' as const, path: '/api/labels/analyze', body: { imageKey: 'labels/x.jpg' } },
  { method: 'post' as const, path: '/api/tastings/tasting-analyzed-0001/analyze', body: {} },
  { method: 'patch' as const, path: '/api/discoveries/discovery-bordeaux/hide', body: {} },
  { method: 'post' as const, path: '/api/wineries', body: { name: '테스트 와이너리' } },
  {
    method: 'post' as const,
    path: '/api/regions',
    body: { name: '테스트 지역', level: 'country' },
  },
];

test.describe('미인증 쓰기 차단', () => {
  for (const endpoint of WRITE_ENDPOINTS) {
    test(`${endpoint.method.toUpperCase()} ${endpoint.path} 는 401 + loginUrl 을 반환한다`, async ({
      request,
      baseURL,
    }) => {
      const response = await request[endpoint.method](endpoint.path, {
        data: endpoint.body,
        headers: { origin: baseURL!, 'content-type': 'application/json' },
      });

      expect(response.status()).toBe(401);
      const json = (await response.json()) as { error?: string; loginUrl?: string };
      expect(json.error).toBe('UNAUTHORIZED');
      expect(json.loginUrl).toBeTruthy();
      expect(json.loginUrl).toContain('/api/auth/google/start');
    });
  }

  test('잘못된 Origin 헤더의 쓰기 요청은 거부된다 (CSRF 방어)', async ({ request }) => {
    const response = await request.post('/api/wines', {
      data: { name: '외부 출처 와인' },
      headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
    });
    // 세션 검증보다 먼저 출처를 거부하거나(403), 최소한 성공하지 않아야 한다
    expect([401, 403]).toContain(response.status());
    expect(response.ok()).toBe(false);
  });

  test('Origin 헤더가 없는 쓰기 요청도 성공하지 않는다', async ({ request }) => {
    const response = await request.post('/api/wines', {
      data: { name: 'Origin 없는 와인' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.ok()).toBe(false);
  });
});

test.describe('OAuth 시작 엔드포인트', () => {
  test('외부 절대 URL 을 returnTo 로 주면 오픈 리다이렉트가 되지 않는다', async ({ request }) => {
    const response = await request.get('/api/auth/google/start?returnTo=https://evil.example.com', {
      maxRedirects: 0,
    });
    const location = response.headers()['location'] ?? '';

    // Google 인증 화면으로만 보내야 한다
    expect(location).toContain('accounts.google.com');
    // 공격자 도메인이 state/redirect 파라미터로 흘러들어가지 않아야 한다
    expect(location).not.toContain('evil.example.com');
    expect(location).not.toContain(encodeURIComponent('https://evil.example.com'));
  });

  test('프로토콜 상대 URL(//evil) 도 차단된다', async ({ request }) => {
    const response = await request.get('/api/auth/google/start?returnTo=//evil.example.com', {
      maxRedirects: 0,
    });
    const location = response.headers()['location'] ?? '';
    expect(location).toContain('accounts.google.com');
    expect(location).not.toContain('evil.example.com');
  });
});

test.describe('쓰기 UI 노출 정책', () => {
  test('비로그인 방문자에게는 시음 상세의 편집·삭제 컨트롤이 보이지 않는다', async ({ page }) => {
    await page.goto('/tastings/tasting-analyzed-0001');
    // 열람은 되지만 쓰기 진입점은 없다
    await expect(page.locator('body')).toContainText('Château Margaux 2015');
    await expect(page.getByRole('button', { name: /수정|삭제/ })).toHaveCount(0);
    await expect(page.getByLabel('수동 평점', { exact: true })).toHaveCount(0);
  });

  test('우상단에 로그인 진입점이 있고 현재 경로로 돌아온다', async ({ page }) => {
    await page.goto('/timeline');
    // '로그인하고 기록하기' 링크와 구분하기 위해 정확 일치로 찾는다
    const login = page.getByRole('link', { name: '로그인', exact: true });
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute('href', '/api/auth/google/start?returnTo=%2Ftimeline');
  });

  test('비로그인 상태에서는 헤더에 기록 링크가 없다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '기록', exact: true })).toHaveCount(0);
  });

  test('/record 는 비로그인 시 폼 대신 로그인 안내를 보여준다', async ({ page }) => {
    const response = await page.goto('/record');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/편집자만 가능/);
    await expect(page.getByRole('link', { name: '로그인' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /녹음 시작/ })).toHaveCount(0);
  });

  test('타임라인에 비로그인 시 로그인해야 기록 가능하다고 표기된다', async ({ page }) => {
    await page.goto('/timeline');
    await expect(page.getByRole('note')).toContainText(/로그인한 편집자만 추가할 수 있습니다/);
    await expect(page.getByRole('link', { name: '로그인하고 기록하기' })).toBeVisible();
    // 기록 추가 버튼은 노출되지 않는다
    await expect(page.getByRole('link', { name: /시음 기록 추가/ })).toHaveCount(0);
  });

  test('대시보드에도 같은 안내가 표기된다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('note').first()).toContainText(
      /로그인한 편집자만 추가할 수 있습니다/,
    );
  });

  test('세션 조회 응답은 캐시되지 않는다', async ({ request }) => {
    const response = await request.get('/api/auth/session');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('공개 페이지 HTML 에는 로그인 상태가 섞이지 않는다 (CDN 캐시 안전)', async ({ page }) => {
    // 세션 판별을 브라우저에서 하므로 서버 HTML 에는 쓰기 UI 가 들어 있지 않아야 한다.
    const response = await page.goto('/tastings/tasting-analyzed-0001');
    const html = (await response?.text()) ?? '';
    expect(html).not.toContain('수동 평점 저장');
  });
});
