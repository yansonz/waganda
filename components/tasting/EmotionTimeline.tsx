import type { ReactElement } from 'react';

/**
 * components/tasting/EmotionTimeline.tsx — 감정 강도 타임라인 (순수 SVG 라인차트, R9).
 *
 * 가로축은 말하기 시작한 시점부터의 시각, 세로축은 감정 강도다.
 * 강도는 숫자 대신 각 지점의 표정 이모지로 보여준다. 데이터가 없으면 안내만 표시한다.
 * 표시 높이는 고정(왼쪽 5축 레이더 차트와 균형), 폭은 부모에 맞춰 늘어난다.
 */
interface EmotionTimelinePoint {
  atSec: number;
  intensity: number;
}

interface EmotionTimelineProps {
  points: EmotionTimelinePoint[];
  /** viewBox 좌표계 기준 크기. height 는 실제 표시 높이로도 쓰인다. */
  width?: number;
  height?: number;
}

/** 축 라벨을 넣을 공간을 방향별로 확보한다. */
const PAD = { top: 16, right: 16, bottom: 24, left: 16 } as const;

/** 이모지가 서로 겹치지 않는 최소 가로 간격(px). 더 촘촘한 지점은 점으로만 찍는다. */
const EMOJI_MIN_GAP = 20;

/** 강도 구간별 표정. 경계는 위에서 아래로 처음 만족하는 것을 쓴다. */
const EMOTION_FACES = [
  { min: 0.8, emoji: '🤩', label: '아주 강함' },
  { min: 0.6, emoji: '😄', label: '강함' },
  { min: 0.4, emoji: '🙂', label: '보통' },
  { min: 0.2, emoji: '😌', label: '약함' },
  { min: 0, emoji: '😐', label: '잔잔함' },
] as const;

/** 감정 강도(0~1)를 표정과 설명으로 바꾼다. */
export function emotionFace(intensity: number): { emoji: string; label: string } {
  const found = EMOTION_FACES.find((f) => intensity >= f.min) ?? EMOTION_FACES[4];
  return { emoji: found.emoji, label: found.label };
}

/** 녹음 시각을 분:초로 표기한다 (예: 83 → 1:23). */
function formatElapsed(sec: number): string {
  const total = Math.round(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function EmotionTimeline({
  points,
  width = 340,
  height = 220,
}: EmotionTimelineProps): ReactElement {
  if (points.length === 0) {
    return (
      <p role="status" className="text-muted text-sm">
        감정 타임라인 데이터가 없습니다.
      </p>
    );
  }

  const atSecs = points.map((p) => p.atSec);
  // 가로축은 첫 발화(시음 시작) 시점부터 시작한다. 앞쪽 침묵 구간은 그리지 않는다.
  const minSec = Math.min(...atSecs);
  const maxSec = Math.max(...atSecs);
  const span = maxSec - minSec > 0 ? maxSec - minSec : 1;
  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;

  const toX = (atSec: number): number => PAD.left + ((atSec - minSec) / span) * innerWidth;
  const toY = (intensity: number): number => PAD.top + innerHeight - intensity * innerHeight;

  const pathD = points
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.atSec).toFixed(1)},${toY(p.intensity).toFixed(1)}`,
    )
    .join(' ');

  // 겹침 방지: 앞서 이모지를 찍은 지점과 EMOJI_MIN_GAP 이상 떨어진 지점만 이모지로 표시한다.
  let lastEmojiX = Number.NEGATIVE_INFINITY;
  const marks = points.map((p) => {
    const x = toX(p.atSec);
    const withEmoji = x - lastEmojiX >= EMOJI_MIN_GAP;
    if (withEmoji) lastEmojiX = x;
    return { ...p, x, y: toY(p.intensity), withEmoji };
  });

  const describedId = 'emotion-timeline-desc';
  // 세로축 기준선: 최저 / 중간 / 최고 강도
  const yTicks = [0, 0.5, 1] as const;
  // 가로축 눈금: 첫 발화 / 중간 / 마지막 지점의 녹음 시각
  const xTicks = maxSec > minSec ? [minSec, (minSec + maxSec) / 2, maxSec] : [minSec];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={describedId}
        preserveAspectRatio="xMidYMid meet"
        style={{ height }}
        className="block w-full"
      >
        <title id={describedId}>
          가로축은 시음 시작 이후 시각, 세로축은 감정 강도인 꺾은선 그래프
        </title>

        {/* 세로축 기준선 */}
        {yTicks.map((t) => (
          <line
            key={`y-${t}`}
            x1={PAD.left}
            y1={toY(t)}
            x2={width - PAD.right}
            y2={toY(t)}
            stroke="var(--color-gold-500)"
            strokeOpacity={t === 0.5 ? 0.15 : 0.25}
            strokeDasharray={t === 0.5 ? '4 4' : undefined}
          />
        ))}

        {/* 가로축 시각 라벨 */}
        {xTicks.map((sec, i) => (
          <text
            key={`x-${i}`}
            x={toX(sec)}
            y={height - PAD.bottom + 16}
            textAnchor={
              xTicks.length === 1
                ? 'middle'
                : i === 0
                  ? 'start'
                  : i === xTicks.length - 1
                    ? 'end'
                    : 'middle'
            }
            fontSize={10}
            fill="var(--color-cream-200)"
            fillOpacity={0.7}
          >
            {formatElapsed(sec)}
          </text>
        ))}

        <path d={pathD} fill="none" stroke="var(--color-gold-500)" strokeWidth={2} />
        {marks.map((m, i) =>
          m.withEmoji ? (
            <text key={i} x={m.x} y={m.y + 5} textAnchor="middle" fontSize={14}>
              {emotionFace(m.intensity).emoji}
            </text>
          ) : (
            <circle key={i} cx={m.x} cy={m.y} r={2.5} fill="var(--color-burgundy-400)" />
          ),
        )}
      </svg>
      <p className="sr-only">
        {points
          .map(
            (p) =>
              `${formatElapsed(p.atSec)} 지점 감정 강도 ${(p.intensity * 100).toFixed(0)}% ${
                emotionFace(p.intensity).label
              }`,
          )
          .join(', ')}
      </p>
    </div>
  );
}
