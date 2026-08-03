import type { MetadataRoute } from 'next';
import { getPublicBaseUrl } from '@/lib/config';

/**
 * robots.txt 생성.
 *
 * 인증 경로와 쓰기 API 경로, 기록 작성 화면(/record)을 크롤링 대상에서 제외한다
 * (design.md 'CSRF와 남용 방지': "인증·쓰기 경로는 robots.txt 에서 크롤링 제외",
 *  requirements.md Requirement 1: "인증 경로와 쓰기 API 경로를 검색엔진 크롤링 대상에서 제외한다").
 *
 * `dynamic = 'force-dynamic'` 이 없으면 Docker 이미지 빌드 시점(APP_BASE_URL 미주입)에
 * 정적으로 생성되어 `sitemap` 필드가 `http://localhost:3000/sitemap.xml` 로 굳어버린다
 * (실제로 발생했던 결함 — 배포 후 robots.txt 가 로컬 주소를 광고했다).
 */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  // 빌드 시점에도 평가되므로 필수 설정을 요구하지 않는 헬퍼를 쓴다.
  const baseUrl = getPublicBaseUrl();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/auth',
        '/api/tastings',
        '/api/recordings',
        '/api/wines',
        '/api/wineries',
        '/api/regions',
        '/api/labels',
        '/api/discoveries',
        '/record',
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
