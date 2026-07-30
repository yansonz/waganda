import type { ReactElement } from 'react';
import type { NoteAxis } from '@waganda/schemas';

/**
 * components/tasting/NotesRadar.tsx — 5축 시음 노트 레이더 차트 (순수 SVG, R9/12.4).
 *
 * 새 차트 라이브러리를 쓰지 않고 다각형 좌표를 직접 계산한다.
 * svg 는 기본이 inline 이므로 block 을 함께 주어야 mx-auto 로 가운데 정렬된다.
 * 접근성: 차트 자체는 장식(aria-hidden)으로 두고, 축 값을 <table> 형태의 대안 텍스트로 함께 제공한다.
 */
interface NotesRadarProps {
  /** 5축 값 (1~5). 값이 없는 축은 중심(0)으로 처리한다. */
  values: Partial<Record<NoteAxis, number>>;
  size?: number;
}

const AXES: { key: NoteAxis; label: string }[] = [
  { key: 'acidity', label: '산미' },
  { key: 'tannin', label: '타닌' },
  { key: 'body', label: '바디' },
  { key: 'aroma', label: '향' },
  { key: 'finish', label: '여운' },
];

const MAX_VALUE = 5;

/** 축 개수만큼 정오각형 꼭짓점 각도(라디안)를 계산한다 — 12시 방향부터 시계방향 */
function angleForIndex(index: number, total: number): number {
  return (Math.PI * 2 * index) / total - Math.PI / 2;
}

function pointFor(
  index: number,
  total: number,
  radius: number,
  center: number,
): { x: number; y: number } {
  const angle = angleForIndex(index, total);
  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle),
  };
}

export function NotesRadar({ values, size = 220 }: NotesRadarProps): ReactElement {
  const center = size / 2;
  const maxRadius = size / 2 - 28; // 라벨 여유 공간

  const dataPoints = AXES.map((axis, i) => {
    const value = values[axis.key] ?? 0;
    const radius = (value / MAX_VALUE) * maxRadius;
    return pointFor(i, AXES.length, radius, center);
  });

  const gridLevels = [0.25, 0.5, 0.75, 1];

  const polygonPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
        role="presentation"
        className="mx-auto block"
      >
        {/* 배경 격자 */}
        {gridLevels.map((level) => {
          const gridPoints = AXES.map((_, i) =>
            pointFor(i, AXES.length, maxRadius * level, center),
          );
          return (
            <polygon
              key={level}
              points={gridPoints.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--color-gold-500)"
              strokeOpacity={0.15}
            />
          );
        })}

        {/* 축 라인 + 라벨 */}
        {AXES.map((axis, i) => {
          const edge = pointFor(i, AXES.length, maxRadius, center);
          const labelPoint = pointFor(i, AXES.length, maxRadius + 16, center);
          return (
            <g key={axis.key}>
              <line
                x1={center}
                y1={center}
                x2={edge.x}
                y2={edge.y}
                stroke="var(--color-gold-500)"
                strokeOpacity={0.2}
              />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12}
                fill="var(--color-cream-300)"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* 데이터 폴리곤 */}
        <polygon
          points={polygonPoints}
          fill="var(--color-burgundy-600)"
          fillOpacity={0.45}
          stroke="var(--color-gold-500)"
          strokeWidth={2}
        />
      </svg>

      {/* 색상 없이도 값을 전달하는 대안 텍스트 표 */}
      <table className="sr-only">
        <caption>5축 시음 노트 값</caption>
        <tbody>
          {AXES.map((axis) => (
            <tr key={axis.key}>
              <th scope="row">{axis.label}</th>
              <td>{values[axis.key] !== undefined ? `${values[axis.key]} / 5` : '값 없음'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
