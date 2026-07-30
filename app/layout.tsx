import type { Metadata } from 'next';
import { Playfair_Display } from 'next/font/google';
import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-playfair',
});

export const metadata: Metadata = {
  title: {
    default: '와간다 — 얀버트 부부의 와인 시음 기록',
    template: '%s · 와간다',
  },
  description:
    '얀버트 부부가 마신 와인을 녹음하고, AI가 대화를 분석해 시음 노트와 취향 패턴을 만들어 주는 기록 서비스',
  openGraph: {
    title: '와간다 — 얀버트 부부의 와인 시음 기록',
    description: '녹음한 대화에서 시음 노트와 취향 패턴을 만들어 주는 와인 기록 서비스',
    type: 'website',
    locale: 'ko_KR',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={playfair.variable}>
      <head>
        {/* Pretendard 는 Google Fonts 에 없어 CDN 으로 로드한다 */}
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
