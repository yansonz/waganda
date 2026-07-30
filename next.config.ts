import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lambda 컨테이너 배포를 위한 standalone 출력 (design.md: Next.js Lambda ARM64 컨테이너)
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  /**
   * 산출물 디렉토리.
   *
   * `next dev` 와 `next build` 가 같은 `.next` 를 쓰면, dev 서버가 떠 있는 상태에서
   * 프로덕션 빌드를 돌릴 때 청크가 교체되어 브라우저에서
   * `a[d] is not a function` 같은 난독화된 TypeError 가 발생한다.
   *
   * 그래서 **프로덕션(build/start)은 `.next-prod`, 개발(dev)은 `.next`** 를 쓴다.
   * NODE_ENV 로 자동 판별하므로 `npm run build` 든 `npx next build` 든 결과가 같다
   * (env 를 잊으면 빌드와 기동이 서로 다른 디렉토리를 보게 되는 함정을 없앤다).
   */
  distDir:
    process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === 'production' ? '.next-prod' : '.next'),
  // 모노레포 워크스페이스 패키지를 트랜스파일 대상에 포함
  transpilePackages: ['@waganda/schemas'],
  experimental: {
    // 서버 액션 페이로드 상한 (라벨 이미지는 S3 사전 서명 업로드를 사용)
    serverActions: { bodySizeLimit: '2mb' },
    // 미들웨어를 Node.js 런타임에서 실행한다.
    // 속도 제한은 DynamoDB(AWS SDK v3) + node:crypto 를 쓰는데 Edge 런타임에서는
    // 둘 다 동작하지 않는다. design.md 의 "앱 계층 속도 제한"을 유지하기 위한 설정.
    // Next 15.5 에서 런타임은 이 플래그를 인식하지만 타입 정의에는 아직 없다.
    // @ts-expect-error nodeMiddleware 는 ExperimentalConfig 타입에 미노출
    nodeMiddleware: true,
  },
};

export default nextConfig;
