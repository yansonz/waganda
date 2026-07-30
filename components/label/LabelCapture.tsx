'use client';

/**
 * components/label/LabelCapture.tsx — 라벨 사진 첨부 및 인식 (R3).
 *
 * requirements.md R3: "라벨 사진이 업로드되면 라벨 인식 에이전트가 필드를 추출한다",
 * "라벨 인식이 실패하면 수동 입력 폼으로 전환하고 사진은 그대로 첨부한다".
 *
 * 흐름:
 * 1. 사진 첨부(카메라 촬영 또는 파일 선택) → `imageKey` 업로드(상위에서 처리) 후
 *    `/api/labels/analyze` 호출.
 * 2. 인식 성공(`recognized: true`) → 필드별 신뢰도와 함께 결과 표시.
 * 3. 인식 실패(`recognized: false`) → **사진은 유지한 채** 수동 입력 폼으로 전환.
 *
 * 편집자 가드가 필요한 모델 호출이므로, 401 발생 시 상위에 알려 로그인 흐름으로
 * 전환할 수 있게 한다(WriteActionGuard 조합은 상위 컴포넌트 책임).
 */
import { useCallback, useId, useRef, useState } from 'react';
import type { FieldConfidence, LabelExtraction } from '@waganda/schemas';

export interface LabelCaptureProps {
  /** 이미지 업로드가 끝나면 imageKey 를 받아 라벨 인식을 요청하는 함수 (상위 주입) */
  uploadImage: (file: File) => Promise<{ imageKey: string }>;
  /** 라벨 인식 API 호출 함수 (상위 주입 — fetch 래핑, 401 처리 등을 상위에서 담당) */
  analyzeLabel: (imageKey: string) => Promise<{ label?: LabelExtraction; error?: string }>;
  /** 인식 성공 시 추출된 필드를 상위로 전달 (와인 폼에 반영) */
  onExtracted?: (label: LabelExtraction) => void;
  /** 인식 실패(또는 에러) 시 수동 입력으로 전환됨을 상위에 알림 */
  onManualFallback?: (reason: string) => void;
}

type CaptureState = 'idle' | 'uploading' | 'analyzing' | 'recognized' | 'manual';

function confidenceBadgeText(confidence: FieldConfidence): string {
  if (confidence === 'low') return '⚠ 확인 필요';
  if (confidence === 'medium') return '보통 신뢰도';
  return '높은 신뢰도';
}

function confidenceBadgeClass(confidence: FieldConfidence): string {
  if (confidence === 'low') return 'bg-gold-500/20 text-gold-400';
  if (confidence === 'medium') return 'bg-ink-700 text-cream-200';
  return 'bg-burgundy-700/30 text-cream-100';
}

/** 라벨 사진 첨부 + 인식 컴포넌트. */
export function LabelCapture({
  uploadImage,
  analyzeLabel,
  onExtracted,
  onManualFallback,
}: LabelCaptureProps) {
  const [state, setState] = useState<CaptureState>('idle');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<LabelExtraction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputId = useId();
  const objectUrlRef = useRef<string | null>(null);

  const handleFileSelected = useCallback(
    async (file: File) => {
      setErrorMessage(null);

      // 사진은 인식 성공/실패와 무관하게 항상 유지한다 (R3).
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setPhotoUrl(url);

      setState('uploading');
      try {
        const { imageKey } = await uploadImage(file);

        setState('analyzing');
        const result = await analyzeLabel(imageKey);

        if (result.error || !result.label || !result.label.recognized) {
          const reason =
            result.error ?? result.label?.failureReason ?? '라벨 정보를 인식하지 못했습니다.';
          setErrorMessage(reason);
          setLabel(null);
          setState('manual');
          onManualFallback?.(reason);
          return;
        }

        setLabel(result.label);
        setState('recognized');
        onExtracted?.(result.label);
      } catch {
        const reason = '라벨 인식 중 오류가 발생했습니다. 수동으로 입력해 주세요.';
        setErrorMessage(reason);
        setLabel(null);
        setState('manual');
        onManualFallback?.(reason);
      }
    },
    [uploadImage, analyzeLabel, onExtracted, onManualFallback],
  );

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) {
      void handleFileSelected(file);
    }
  }

  return (
    <div className="card space-y-3 p-4" data-testid="label-capture">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-sm font-medium text-cream-100">
          라벨 사진
        </label>
        <span className="text-xs text-muted" data-testid="label-capture-state">
          {state === 'idle' && '사진을 첨부해 주세요'}
          {state === 'uploading' && '업로드 중…'}
          {state === 'analyzing' && '인식 중…'}
          {state === 'recognized' && '인식 완료'}
          {state === 'manual' && '수동 입력 모드'}
        </span>
      </div>

      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInputChange}
        aria-label="라벨 사진 촬영 또는 선택"
        className="block w-full text-sm text-cream-100"
      />

      {photoUrl && (
        // 첨부된 라벨 사진 — 인식 실패해도 계속 표시된다 (R3).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt="첨부된 와인 라벨 사진"
          className="max-h-64 w-full rounded-md object-contain"
          data-testid="label-photo-preview"
        />
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-burgundy-300" data-testid="label-capture-error">
          {errorMessage} 사진은 그대로 유지되며, 아래 폼에 직접 입력할 수 있습니다.
        </p>
      )}

      {state === 'recognized' && label && (
        <ul className="space-y-1" aria-label="라벨 인식 결과">
          {label.name && (
            <li className="flex items-center gap-2 text-sm text-cream-100">
              와인명: {label.name.value}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(label.name.confidence)}`}
              >
                {confidenceBadgeText(label.name.confidence)}
              </span>
            </li>
          )}
          {label.vintage && (
            <li className="flex items-center gap-2 text-sm text-cream-100">
              빈티지: {label.vintage.value}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(label.vintage.confidence)}`}
              >
                {confidenceBadgeText(label.vintage.confidence)}
              </span>
            </li>
          )}
          {label.wineryName && (
            <li className="flex items-center gap-2 text-sm text-cream-100">
              와이너리: {label.wineryName.value}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(label.wineryName.confidence)}`}
              >
                {confidenceBadgeText(label.wineryName.confidence)}
              </span>
            </li>
          )}
          {label.country && (
            <li className="flex items-center gap-2 text-sm text-cream-100">
              국가: {label.country.value}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(label.country.confidence)}`}
              >
                {confidenceBadgeText(label.country.confidence)}
              </span>
            </li>
          )}
          {label.regionName && (
            <li className="flex items-center gap-2 text-sm text-cream-100">
              지역: {label.regionName.value}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(label.regionName.confidence)}`}
              >
                {confidenceBadgeText(label.regionName.confidence)}
              </span>
            </li>
          )}
          {label.alcoholPercent && (
            <li className="flex items-center gap-2 text-sm text-cream-100">
              알코올 도수: {label.alcoholPercent.value}%
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(label.alcoholPercent.confidence)}`}
              >
                {confidenceBadgeText(label.alcoholPercent.confidence)}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
