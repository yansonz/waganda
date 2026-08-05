'use client';

import Image from 'next/image';
import { useRef, useState, type ReactElement } from 'react';
import { EditorOnly, useEditorSession } from '@/components/auth/EditorSession';
import { useWriteAction } from '@/components/auth/WriteActionGuard';
import { prepareLabelImage } from '@/lib/upload/image';
import { mediaUrl } from '@/lib/views/read';

/**
 * components/tasting/FoodPhotos.tsx — 곁들인 음식 사진 표시·추가·삭제 (음식 사진 업로드 기능).
 *
 * 정책(docs/issues/food-photo-upload.md):
 * - 열람자: 사진이 있을 때만 "곁들인 음식" 제목 + 96px 썸네일 그리드. 없으면 아무것도 그리지 않는다.
 * - 편집자: 0장이면 "음식 사진 추가" 텍스트 버튼만, 1장 이상이면 그리드 끝에 추가 버튼과
 *   각 사진에 삭제 아이콘을 함께 그린다. 최대 8장.
 * - 라벨(메인)보다 부각되지 않도록 제목·썸네일 크기를 제한한다.
 *
 * 업로드는 라벨과 동일한 3단계다: presign(POST) → S3 직접 PUT(사전 서명 URL) → 등록(PATCH).
 * 쓰기 API 는 `runWriteAction` 을 경유해 401 을 로그인 흐름으로 전환하지만, S3 PUT 은
 * 사전 서명 URL 이라 CloudFront 를 거치지 않으므로 `signedFetch`/`runWriteAction` 을 쓰지 않는다.
 * 성공 시 페이지를 새로고침해 서버 컴포넌트를 갱신한다.
 */

/** 음식 사진 상한 (docs/issues/food-photo-upload.md) */
const MAX_FOOD_PHOTOS = 8;

interface FoodPhotosProps {
  tastingId: string;
  foodImageKeys: string[];
  rev: number;
}

interface PresignResponse {
  imageKey: string;
  uploadUrl: string;
  expiresInSec: number;
}

export function FoodPhotos({
  tastingId,
  foodImageKeys,
  rev,
}: FoodPhotosProps): ReactElement | null {
  const { authenticated } = useEditorSession();
  const { runWriteAction } = useWriteAction({ formId: `food-photos-${tastingId}` });
  const inputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasPhotos = foodImageKeys.length > 0;
  const canAddMore = foodImageKeys.length < MAX_FOOD_PHOTOS;

  // 열람자에게 사진이 없으면 아무것도 렌더링하지 않는다.
  if (!hasPhotos && !authenticated) return null;

  const endpoint = `/api/tastings/${tastingId}/food-photos`;

  /** 원본 사진을 새 탭으로 연다. */
  function openOriginal(key: string): void {
    window.open(mediaUrl(key), '_blank');
  }

  /** 파일 선택 → 준비 → presign → S3 PUT → 등록. */
  async function handleFileSelected(file: File): Promise<void> {
    setErrorMessage(null);
    setIsBusy(true);
    try {
      // HEIC 변환·축소는 라벨 업로드와 동일한 준비 로직을 재사용한다.
      const prepared = await prepareLabelImage(file);
      if (!prepared.ok) {
        setErrorMessage(prepared.reason);
        return;
      }
      const uploadFile = prepared.file;

      // 1. 사전 서명 URL 발급
      const presignResponse = await runWriteAction(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: uploadFile.type, sizeBytes: uploadFile.size }),
      });
      if (!presignResponse.ok) {
        if (presignResponse.status !== 401) {
          setErrorMessage('사진 업로드를 준비하지 못했습니다. 다시 시도해 주세요.');
        }
        return;
      }
      const { imageKey, uploadUrl } = (await presignResponse.json()) as PresignResponse;

      // 2. S3 로 직접 PUT — 사전 서명 URL 이라 signedFetch/runWriteAction 을 쓰지 않는다.
      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': uploadFile.type },
        body: uploadFile,
      });
      if (!putResponse.ok) {
        setErrorMessage('사진 저장소에 업로드하지 못했습니다. 다시 시도해 주세요.');
        return;
      }

      // 3. 키 등록(confirm)
      const confirmResponse = await runWriteAction(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageKey, rev }),
      });
      if (!confirmResponse.ok) {
        if (confirmResponse.status !== 401) {
          setErrorMessage('사진을 기록에 반영하지 못했습니다. 다시 시도해 주세요.');
        }
        return;
      }

      // 서버 컴포넌트를 갱신해 새 사진과 최신 rev 를 반영한다.
      window.location.reload();
    } catch {
      setErrorMessage('네트워크 오류로 사진을 추가하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setIsBusy(false);
    }
  }

  /** 사진 삭제. */
  async function handleDelete(key: string): Promise<void> {
    if (!window.confirm('이 음식 사진을 삭제할까요?')) return;
    setErrorMessage(null);
    setIsBusy(true);
    try {
      const response = await runWriteAction(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageKey: key, rev }),
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
      if (response.status !== 401) {
        setErrorMessage('사진을 삭제하지 못했습니다. 다시 시도해 주세요.');
      }
    } catch {
      setErrorMessage('네트워크 오류로 사진을 삭제하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setIsBusy(false);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 선택해도 change 가 발생하도록 값을 비운다.
    event.target.value = '';
    if (file) {
      void handleFileSelected(file);
    }
  }

  function openFilePicker(): void {
    inputRef.current?.click();
  }

  return (
    <section className="space-y-2">
      {hasPhotos && <h2 className="font-display text-base text-cream-100">곁들인 음식</h2>}

      {/* 파일 선택 input — 버튼 클릭으로 열며 화면에는 감춘다. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        aria-label="음식 사진 선택"
        className="hidden"
      />

      {hasPhotos && (
        <div className="flex flex-wrap gap-2">
          {foodImageKeys.map((key) => (
            <div key={key} className="relative">
              <button
                type="button"
                onClick={() => openOriginal(key)}
                aria-label="음식 사진 원본 보기"
                className="block"
              >
                <Image
                  src={mediaUrl(key)}
                  alt="곁들인 음식 사진"
                  width={96}
                  height={96}
                  unoptimized
                  className="h-24 w-24 rounded-lg border border-gold-500/20 object-cover"
                />
              </button>
              <EditorOnly>
                <button
                  type="button"
                  onClick={() => handleDelete(key)}
                  disabled={isBusy}
                  aria-label="음식 사진 삭제"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink-900/80 text-sm text-cream-100 hover:bg-burgundy-700/80 disabled:opacity-50"
                >
                  ✕
                </button>
              </EditorOnly>
            </div>
          ))}

          {/* 1장 이상일 때: 그리드 끝의 추가 버튼 */}
          {canAddMore && (
            <EditorOnly>
              <button
                type="button"
                onClick={openFilePicker}
                disabled={isBusy}
                aria-label="음식 사진 추가"
                className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-gold-500/30 text-cream-300 transition-colors hover:border-gold-500/60 hover:text-cream-100 disabled:opacity-50"
              >
                {isBusy ? '처리 중…' : '+'}
              </button>
            </EditorOnly>
          )}
        </div>
      )}

      {/* 0장 + 편집자: 제목·경계선 없이 텍스트 버튼만 */}
      {!hasPhotos && (
        <EditorOnly>
          <button
            type="button"
            onClick={openFilePicker}
            disabled={isBusy}
            className="text-sm text-cream-300 transition-colors hover:text-cream-100 disabled:opacity-50"
          >
            {isBusy ? '처리 중…' : '📷 음식 사진 추가'}
          </button>
        </EditorOnly>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-burgundy-300">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
