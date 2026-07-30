// @vitest-environment node
/**
 * 리다이렉트 절대 URL 생성 회귀 테스트.
 *
 * 이 서비스는 CloudFront → Lambda Function URL 구조이고, OAC 서명과 충돌하지 않도록
 * 오리진 요청 정책에서 `host` 헤더를 제외한다. 그래서 Next.js 는 원래 호스트를 알 수 없고
 * `request.nextUrl.origin` 이 컨테이너의 내부 바인딩 주소(`https://0.0.0.0:3000`)가 된다.
 *
 * 실제로 Google 로그인 후 그 주소로 리다이렉트되어 화면이 열리지 않는 문제가 있었다
 * (세션 쿠키는 정상 발급되어 되돌아가면 로그인된 상태였다).
 * 리다이렉트 대상은 반드시 설정값(`APP_BASE_URL`)을 기준으로 만들어야 한다.
 */
import { describe, expect, it } from 'vitest';
import { absoluteUrl } from '@/lib/config';

describe('absoluteUrl', () => {
  it('앱 경로를 APP_BASE_URL 기준 절대 URL 로 만든다', () => {
    // vitest.setup 이 APP_BASE_URL=https://waganda.test 로 고정한다.
    expect(absoluteUrl('/')).toBe('https://waganda.test/');
    expect(absoluteUrl('/record')).toBe('https://waganda.test/record');
  });

  it('쿼리·프래그먼트가 있는 경로도 그대로 붙인다', () => {
    expect(absoluteUrl('/?login=failed')).toBe('https://waganda.test/?login=failed');
  });

  it('슬래시로 시작하지 않는 경로도 처리한다', () => {
    expect(absoluteUrl('record')).toBe('https://waganda.test/record');
  });

  it('요청 호스트가 아니라 설정값을 쓴다 (내부 주소가 새어나오지 않는다)', () => {
    // 컨테이너 내부 주소가 결과에 절대 포함되면 안 된다.
    for (const path of ['/', '/record', '/wines']) {
      expect(absoluteUrl(path)).not.toContain('0.0.0.0');
      expect(absoluteUrl(path).startsWith('https://waganda.test')).toBe(true);
    }
  });
});
