import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmotionTimeline, emotionFace } from '@/components/tasting/EmotionTimeline';

/**
 * __tests__/views/emotion-timeline.test.tsx — 감정 타임라인 표기 규칙 검증.
 * 표정은 데이터 지점에만 붙이고, 가로축은 말하기 시작한 시점부터 그린다.
 */
describe('감정 타임라인 표기', () => {
  // 첫 발화가 12초 지점인 기록 (앞 12초는 침묵)
  const points = [
    { atSec: 12, intensity: 0.15 },
    { atSec: 45, intensity: 0.55 },
    { atSec: 83, intensity: 0.9 },
  ];

  it('가로축 눈금이 0:00 이 아니라 첫 발화 시각부터 시작한다', () => {
    render(<EmotionTimeline points={points} />);
    expect(screen.getByText('0:12')).toBeInTheDocument();
    // 중간 눈금 (12+83)/2 = 47.5 → 0:48, 끝 눈금 1:23
    expect(screen.getByText('0:48')).toBeInTheDocument();
    expect(screen.getByText('1:23')).toBeInTheDocument();
    expect(screen.queryByText('0:00')).not.toBeInTheDocument();
  });

  it('표정은 데이터 지점에만 하나씩 붙고 세로축 눈금에는 붙지 않는다', () => {
    render(<EmotionTimeline points={points} />);
    // 0.15 → 😐, 0.55 → 🙂, 0.9 → 🤩 각 1개씩
    expect(screen.getAllByText('😐')).toHaveLength(1);
    expect(screen.getAllByText('🙂')).toHaveLength(1);
    expect(screen.getAllByText('🤩')).toHaveLength(1);
  });

  it('세로축에 퍼센트 눈금을 표시하지 않는다', () => {
    render(<EmotionTimeline points={points} />);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('축 이름과 범례 캡션은 그리지 않는다', () => {
    render(<EmotionTimeline points={points} />);
    expect(screen.queryByText('녹음 경과 시간')).not.toBeInTheDocument();
    expect(screen.queryByText('감정 강도')).not.toBeInTheDocument();
    expect(screen.queryByText(/가로: 녹음 경과 시간/)).not.toBeInTheDocument();
  });

  it('폭은 부모에 맞추고 높이는 5축 레이더(220px)와 같게 고정한다', () => {
    const { container } = render(<EmotionTimeline points={points} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 340 220');
    expect(svg?.getAttribute('class')).toContain('w-full');
    expect(svg?.style.height).toBe('220px');
  });

  it('지점이 하나뿐이어도 오류 없이 렌더링한다', () => {
    render(<EmotionTimeline points={[{ atSec: 30, intensity: 0.5 }]} />);
    expect(screen.getByText('0:30')).toBeInTheDocument();
  });

  it('스크린리더용 서술에 시각과 강도, 표정 설명을 함께 담는다', () => {
    render(<EmotionTimeline points={points} />);
    expect(screen.getByText(/1:23 지점 감정 강도 90% 아주 강함/)).toBeInTheDocument();
  });
});

describe('emotionFace 강도 구간 매핑', () => {
  it('구간 경계값을 위쪽 구간으로 판정한다', () => {
    expect(emotionFace(1).label).toBe('아주 강함');
    expect(emotionFace(0.8).label).toBe('아주 강함');
    expect(emotionFace(0.6).label).toBe('강함');
    expect(emotionFace(0.4).label).toBe('보통');
    expect(emotionFace(0.2).label).toBe('약함');
    expect(emotionFace(0).label).toBe('잔잔함');
  });

  it('모든 구간이 서로 다른 표정을 쓴다', () => {
    const emojis = [0, 0.2, 0.4, 0.6, 0.8].map((v) => emotionFace(v).emoji);
    expect(new Set(emojis).size).toBe(5);
  });
});
