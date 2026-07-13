"use client";

import { useCallback, useRef, useState } from "react";
import ImageAnnotator from "@/components/ImageAnnotator";
import CompareSlider from "@/components/CompareSlider";
import StructurePlacer from "@/components/StructurePlacer";
import type {
  AnalyzeResponse,
  Classification,
  DetectedObject,
  GenerateResponse,
} from "@/lib/types";

type Step =
  | "upload"
  | "analyzing"
  | "review"
  | "generating"
  | "result"
  | "place"
  | "placed";

const NEXT_CLASSIFICATION: Record<Classification, Classification> = {
  remove: "preserve",
  preserve: "uncertain",
  uncertain: "remove",
};

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  remove: "제거",
  preserve: "보존",
  uncertain: "확인 필요",
};

const CLASSIFICATION_CHIP: Record<Classification, string> = {
  remove: "bg-red-100 text-red-700 border-red-300",
  preserve: "bg-blue-100 text-blue-700 border-blue-300",
  uncertain: "bg-yellow-100 text-yellow-700 border-yellow-300",
};

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [image, setImage] = useState<string | null>(null);
  const [objects, setObjects] = useState<DetectedObject[]>([]);
  const [originalObjects, setOriginalObjects] = useState<DetectedObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [placeBase, setPlaceBase] = useState<string | null>(null);
  const [placedImage, setPlacedImage] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userBoxSeq = useRef(0);

  const addUserBox = (bbox: [number, number, number, number]) => {
    const id = `user_${++userBoxSeq.current}`;
    setObjects((prev) => [
      ...prev,
      {
        id,
        label: `직접 지정 ${userBoxSeq.current}`,
        classification: "remove",
        bbox,
        confidence: 1,
      },
    ]);
    setSelectedId(id);
  };

  const removeUserBox = (id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setObjects([]);
      setOriginalObjects([]);
      setResultImage(null);
      setSelectedId(null);
      setError(null);
      setStep("upload");
    };
    reader.readAsDataURL(file);
  }, []);

  const analyze = async () => {
    if (!image) return;
    setStep("analyzing");
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data = (await res.json()) as AnalyzeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `분석 실패 (${res.status})`);
      setObjects(data.objects);
      setOriginalObjects(data.objects);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석 중 오류가 발생했습니다.");
      setStep("upload");
    }
  };

  const toggleClassification = (id: string) => {
    setObjects((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, classification: NEXT_CLASSIFICATION[o.classification] }
          : o
      )
    );
  };

  const generate = async () => {
    if (!image) return;
    const removeTargets = objects.filter((o) => o.classification === "remove");
    if (removeTargets.length === 0) {
      setError("제거 대상으로 표시된 객체가 없습니다.");
      return;
    }

    // 파인튜닝용 수정 이력: GPT 원래 분류 vs 사용자 최종 분류
    const corrections = objects
      .map((o) => {
        const orig = originalObjects.find((x) => x.id === o.id);
        return orig && orig.classification !== o.classification
          ? {
              id: o.id,
              label: o.label,
              original: orig.classification,
              final: o.classification,
            }
          : null;
      })
      .filter(Boolean);
    console.log(
      "[correction-log]",
      JSON.stringify({ timestamp: new Date().toISOString(), corrections }, null, 2)
    );

    setStep("generating");
    setDrawMode(false);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          boxes: removeTargets.map((o) => o.bbox),
        }),
      });
      const data = (await res.json()) as GenerateResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `생성 실패 (${res.status})`);
      setResultImage(data.resultImage);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 중 오류가 발생했습니다.");
      setStep("review");
    }
  };

  const placeStructures = async (collage: string, itemCount: number) => {
    setPlacing(true);
    setError(null);
    console.log(`[place] ${itemCount}개 구조물 합성 요청`);
    try {
      const res = await fetch("/api/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: collage }),
      });
      const data = (await res.json()) as GenerateResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `배치 실패 (${res.status})`);
      setPlacedImage(data.resultImage);
      setStep("placed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "배치 중 오류가 발생했습니다.");
    } finally {
      setPlacing(false);
    }
  };

  const reset = () => {
    setImage(null);
    setObjects([]);
    setOriginalObjects([]);
    setResultImage(null);
    setPlaceBase(null);
    setPlacedImage(null);
    setPlacing(false);
    setSelectedId(null);
    setError(null);
    setDrawMode(false);
    userBoxSeq.current = 0;
    setStep("upload");
  };

  const removeCount = objects.filter((o) => o.classification === "remove").length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">
          이벤트플러스 <span className="font-normal text-gray-500">빈 공간 생성기</span>
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          행사 공간 사진을 업로드하면 AI가 임시 설치물을 찾아 제거된 빈 공간
          이미지를 만들어 드립니다.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 1단계: 업로드 */}
      {!image && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) loadFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex h-72 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
            dragOver
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-gray-400"
          }`}
        >
          <p className="text-lg font-medium text-gray-700">
            사진을 여기에 끌어다 놓거나 클릭해서 선택하세요
          </p>
          <p className="mt-2 text-sm text-gray-400">JPG, PNG 등 이미지 파일</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) loadFile(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {/* 2~4단계: 미리보기 / 분석 / 수정 */}
      {image &&
        (step === "upload" ||
          step === "analyzing" ||
          step === "review" ||
          step === "generating") && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <ImageAnnotator
              image={image}
              objects={step === "review" || step === "generating" ? objects : []}
              selectedId={selectedId}
              onSelect={setSelectedId}
              drawMode={drawMode && step === "review"}
              onDraw={addUserBox}
            />
          </div>

          <aside className="flex flex-col gap-4">
            {step === "upload" && (
              <>
                <button
                  onClick={analyze}
                  className="rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
                >
                  분석하기
                </button>
                <button
                  onClick={reset}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  다른 사진 선택
                </button>
              </>
            )}

            {step === "analyzing" && (
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
                <Spinner />
                <span className="text-sm text-gray-600">
                  AI가 사진 속 물체를 분석하고 있습니다…
                </span>
              </div>
            )}

            {(step === "review" || step === "generating") && (
              <>
                <div className="rounded-lg border border-gray-200 bg-white">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <h2 className="font-medium">
                      탐지된 객체{" "}
                      <span className="text-sm text-gray-400">
                        ({objects.length}개)
                      </span>
                    </h2>
                    <p className="mt-1 text-xs text-gray-400">
                      분류 배지를 클릭하면 제거 → 보존 → 확인 필요 순으로
                      바뀝니다. &quot;확인 필요&quot;는 제거되지 않습니다.
                    </p>
                  </div>
                  <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
                    {objects.map((o) => (
                      <li
                        key={o.id}
                        onClick={() =>
                          setSelectedId(selectedId === o.id ? null : o.id)
                        }
                        className={`flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-sm ${
                          selectedId === o.id ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="truncate">
                          {o.label}
                          <span className="ml-1.5 text-xs text-gray-400">
                            {Math.round(o.confidence * 100)}%
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleClassification(o.id);
                            }}
                            disabled={step === "generating"}
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CLASSIFICATION_CHIP[o.classification]} disabled:opacity-50`}
                          >
                            {CLASSIFICATION_LABEL[o.classification]}
                          </button>
                          {o.id.startsWith("user_") && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeUserBox(o.id);
                              }}
                              disabled={step === "generating"}
                              className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-50"
                              title="영역 삭제"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                    {objects.length === 0 && (
                      <li className="px-4 py-6 text-center text-sm text-gray-400">
                        탐지된 객체가 없습니다.
                      </li>
                    )}
                  </ul>
                </div>

                {step === "review" && (
                  <button
                    onClick={() => setDrawMode((v) => !v)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                      drawMode
                        ? "border-red-400 bg-red-50 text-red-600"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {drawMode
                      ? "그리기 종료 (드래그해서 영역 추가 중)"
                      : "+ 지울 영역 직접 그리기"}
                  </button>
                )}

                {step === "review" ? (
                  <button
                    onClick={generate}
                    disabled={removeCount === 0}
                    className="rounded-lg bg-red-600 px-4 py-3 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    빈 공간 생성 ({removeCount}개 제거)
                  </button>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
                    <Spinner />
                    <span className="text-sm text-gray-600">
                      빈 공간 이미지를 생성하고 있습니다… (수십 초 걸릴 수
                      있어요)
                    </span>
                  </div>
                )}

                <button
                  onClick={reset}
                  disabled={step === "generating"}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  처음부터 다시
                </button>
              </>
            )}
          </aside>
        </div>
      )}

      {/* 5단계: 결과 비교 */}
      {image && resultImage && step === "result" && (
        <div className="flex flex-col gap-4">
          <CompareSlider before={image} after={resultImage} />
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                setPlaceBase(resultImage);
                setStep("place");
              }}
              className="rounded-lg bg-green-600 px-4 py-2.5 font-medium text-white hover:bg-green-700"
            >
              구조물 배치하기 →
            </button>
            <a
              href={resultImage}
              download="event-plus-result.png"
              className="rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700"
            >
              결과 이미지 다운로드
            </a>
            <button
              onClick={() => setStep("review")}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-600 hover:bg-gray-50"
            >
              분류 다시 수정
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-600 hover:bg-gray-50"
            >
              새 사진으로 시작
            </button>
          </div>
        </div>
      )}

      {/* 6단계: 구조물 배치 */}
      {placeBase && step === "place" && (
        <StructurePlacer
          baseImage={placeBase}
          busy={placing}
          onFinalize={placeStructures}
        />
      )}

      {/* 7단계: 배치 결과 */}
      {placeBase && placedImage && step === "placed" && (
        <div className="flex flex-col gap-4">
          <CompareSlider before={placeBase} after={placedImage} />
          <div className="flex flex-wrap gap-3">
            <a
              href={placedImage}
              download="event-plus-placed.png"
              className="rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700"
            >
              결과 이미지 다운로드
            </a>
            <button
              onClick={() => {
                setPlaceBase(placedImage);
                setPlacedImage(null);
                setStep("place");
              }}
              className="rounded-lg bg-green-600 px-4 py-2.5 font-medium text-white hover:bg-green-700"
            >
              이어서 더 배치하기
            </button>
            <button
              onClick={() => setStep("place")}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-600 hover:bg-gray-50"
            >
              다시 배치
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-600 hover:bg-gray-50"
            >
              새 사진으로 시작
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
  );
}
