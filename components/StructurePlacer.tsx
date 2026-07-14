"use client";

import { useRef, useState } from "react";

export interface StructureDef {
  type: string;
  label: string;
  src: string;
  /** 새로 추가될 때의 초기 너비 (이미지 너비 대비 비율) */
  initialW: number;
}

export const STRUCTURES: StructureDef[] = [
  { type: "chair", label: "의자", src: "/sprites/chair.webp", initialW: 0.12 },
  { type: "table", label: "테이블", src: "/sprites/table.webp", initialW: 0.2 },
  { type: "booth", label: "부스", src: "/sprites/booth.webp", initialW: 0.3 },
  { type: "stage", label: "무대", src: "/sprites/stage.webp", initialW: 0.35 },
  { type: "banner", label: "배너", src: "/sprites/banner.webp", initialW: 0.1 },
];

interface PlacedItem {
  id: string;
  type: string;
  src: string;
  /** 중심 좌표, 컨테이너 대비 0~1 */
  x: number;
  y: number;
  /** 너비, 컨테이너 너비 대비 0~1 */
  w: number;
  /** 회전 각도 (deg, 시계방향) */
  rot: number;
}

type DragMode = "move" | "resize" | "rotate";

interface DragState {
  mode: DragMode;
  id: string;
  startPointer: [number, number];
  orig: PlacedItem;
}

interface Props {
  baseImage: string;
  busy: boolean;
  onFinalize: (collageDataUrl: string, itemCount: number) => void;
}

let seq = 0;

export default function StructurePlacer({ baseImage, busy, onFinalize }: Props) {
  const [items, setItems] = useState<PlacedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutPrompt, setLayoutPrompt] = useState("");
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [customDefs, setCustomDefs] = useState<StructureDef[]>([]);
  const [spriteName, setSpriteName] = useState("");
  const [spriteBusy, setSpriteBusy] = useState(false);
  const [spriteError, setSpriteError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const allDefs = [...STRUCTURES, ...customDefs];

  const createSprite = async () => {
    const name = spriteName.trim();
    if (!name || spriteBusy) return;
    setSpriteBusy(true);
    setSpriteError(null);
    try {
      const res = await fetch("/api/sprite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { sprite?: string; error?: string };
      if (!res.ok || !data.sprite) {
        throw new Error(data.error ?? `구조물 생성 실패 (${res.status})`);
      }
      const def: StructureDef = {
        type: `custom_${++seq}`,
        label: name,
        src: data.sprite,
        initialW: 0.18,
      };
      setCustomDefs((prev) => [...prev, def]);
      addItem(def); // 만들자마자 화면에 배치
      setSpriteName("");
    } catch (e) {
      setSpriteError(
        e instanceof Error ? e.message : "구조물 생성 중 오류가 발생했습니다."
      );
    } finally {
      setSpriteBusy(false);
    }
  };

  const requestLayout = async () => {
    if (!layoutPrompt.trim() || layoutBusy) return;
    setLayoutBusy(true);
    setLayoutError(null);
    try {
      const res = await fetch("/api/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: baseImage,
          prompt: layoutPrompt,
          structures: allDefs.map((d) => ({ type: d.type, label: d.label })),
        }),
      });
      const data = (await res.json()) as {
        placements?: { type: string; x: number; y: number; w: number; rot: number }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `배치 계산 실패 (${res.status})`);
      const added: PlacedItem[] = (data.placements ?? [])
        .map((p) => {
          const def = allDefs.find((s) => s.type === p.type);
          if (!def) return null;
          return {
            id: `pl_${++seq}`,
            type: def.type,
            src: def.src,
            x: p.x,
            y: p.y,
            w: p.w,
            rot: p.rot,
          };
        })
        .filter((p): p is PlacedItem => p !== null);
      if (added.length === 0) {
        setLayoutError("배치할 구조물을 만들지 못했습니다. 지시를 바꿔보세요.");
      } else {
        setItems((prev) => [...prev, ...added]);
        setLayoutPrompt("");
      }
    } catch (e) {
      setLayoutError(
        e instanceof Error ? e.message : "배치 계산 중 오류가 발생했습니다."
      );
    } finally {
      setLayoutBusy(false);
    }
  };

  const addItem = (def: StructureDef) => {
    const item: PlacedItem = {
      id: `pl_${++seq}`,
      type: def.type,
      src: def.src,
      x: 0.5,
      y: 0.6,
      w: def.initialW,
      rot: 0,
    };
    setItems((prev) => [...prev, item]);
    setSelectedId(item.id);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const startDrag = (
    e: React.PointerEvent,
    id: string,
    mode: DragMode
  ) => {
    if (busy) return;
    e.stopPropagation();
    e.preventDefault();
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setSelectedId(id);
    dragRef.current = {
      mode,
      id,
      startPointer: [e.clientX, e.clientY],
      orig: { ...item },
    };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;

    const dx = (e.clientX - drag.startPointer[0]) / rect.width;
    const dy = (e.clientY - drag.startPointer[1]) / rect.height;

    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== drag.id) return item;
        if (drag.mode === "move") {
          return {
            ...item,
            x: Math.min(1, Math.max(0, drag.orig.x + dx)),
            y: Math.min(1, Math.max(0, drag.orig.y + dy)),
          };
        }
        if (drag.mode === "resize") {
          // 중심에서 포인터까지의 가로 거리 기준으로 너비 조절
          const cx = drag.orig.x * rect.width + rect.left;
          const cy = drag.orig.y * rect.height + rect.top;
          const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
          const newW = (dist * 2) / rect.width / Math.SQRT2;
          return { ...item, w: Math.min(0.9, Math.max(0.04, newW)) };
        }
        // rotate: 중심→포인터 각도 (핸들이 위쪽이므로 +90도 보정)
        const cx = drag.orig.x * rect.width + rect.left;
        const cy = drag.orig.y * rect.height + rect.top;
        const angle =
          (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
        return { ...item, rot: Math.round(angle) };
      })
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const finalize = async () => {
    if (items.length === 0) return;
    const loadImg = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });

    const base = await loadImg(baseImage);
    const canvas = document.createElement("canvas");
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(base, 0, 0);

    for (const item of items) {
      const sprite = await loadImg(item.src);
      const w = item.w * canvas.width;
      const h = w * (sprite.naturalHeight / sprite.naturalWidth);
      ctx.save();
      ctx.translate(item.x * canvas.width, item.y * canvas.height);
      ctx.rotate((item.rot * Math.PI) / 180);
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    // PNG는 사진 콜라주에서 수 MB가 되어 서버 전송 제한(4.5MB)에 걸릴 수 있어 JPEG 사용
    onFinalize(canvas.toDataURL("image/jpeg", 0.92), items.length);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div
        ref={containerRef}
        className="relative w-full touch-none select-none overflow-hidden rounded-lg"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={() => setSelectedId(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baseImage}
          alt="배치 대상 이미지"
          className="w-full"
          draggable={false}
        />
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <div
              key={item.id}
              className="absolute"
              style={{
                left: `${item.x * 100}%`,
                top: `${item.y * 100}%`,
                width: `${item.w * 100}%`,
                transform: `translate(-50%, -50%) rotate(${item.rot}deg)`,
                cursor: busy ? "default" : "move",
              }}
              onPointerDown={(e) => startDrag(e, item.id, "move")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.src}
                alt={item.type}
                className={`w-full ${
                  selected ? "outline-2 outline-dashed outline-blue-500" : ""
                }`}
                draggable={false}
              />
              {selected && !busy && (
                <>
                  {/* 회전 핸들 (위) */}
                  <div
                    className="absolute -top-8 left-1/2 h-6 w-6 -translate-x-1/2 cursor-grab rounded-full border-2 border-blue-500 bg-white shadow"
                    onPointerDown={(e) => startDrag(e, item.id, "rotate")}
                    title="드래그해서 회전"
                  >
                    <span className="flex h-full w-full items-center justify-center text-xs text-blue-600">
                      ⟳
                    </span>
                  </div>
                  <div className="absolute -top-3 left-1/2 h-3 w-0.5 -translate-x-1/2 bg-blue-500" />
                  {/* 크기 핸들 (우하단) */}
                  <div
                    className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-blue-500 bg-white shadow"
                    onPointerDown={(e) => startDrag(e, item.id, "resize")}
                    title="드래그해서 크기 조절"
                  />
                  {/* 삭제 버튼 (우상단) */}
                  <button
                    type="button"
                    className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white shadow hover:bg-red-600"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeItem(item.id)}
                    title="삭제"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-1 font-medium">구조물 추가</h2>
          <p className="mb-3 text-xs text-gray-400">
            버튼을 누르면 이미지 위에 구조물이 나타납니다. 드래그로 이동,
            위쪽 핸들로 회전, 오른쪽 아래 핸들로 크기 조절.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {allDefs.map((def) => (
              <button
                key={def.type}
                onClick={() => addItem(def)}
                disabled={busy}
                className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 p-2 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={def.src}
                  alt={def.label}
                  className="h-12 w-12 object-contain"
                  draggable={false}
                />
                <span className="text-xs text-gray-600">{def.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="mb-2 text-xs text-gray-400">
              목록에 없는 구조물은 이름을 입력하면 AI가 만들어 추가합니다
              (~15초)
            </p>
            <div className="flex gap-2">
              <input
                value={spriteName}
                onChange={(e) => setSpriteName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createSprite();
                  }
                }}
                disabled={busy || spriteBusy}
                placeholder="예: 포토월, LED 스크린"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
              />
              <button
                onClick={createSprite}
                disabled={busy || spriteBusy || !spriteName.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {spriteBusy && (
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {spriteBusy ? "생성 중" : "만들기"}
              </button>
            </div>
            {spriteError && (
              <p className="mt-1 text-xs text-red-500">{spriteError}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-1 font-medium">AI 배치 지시</h2>
          <p className="mb-3 text-xs text-gray-400">
            글로 지시하면 AI가 공간에 맞게 구조물을 배치합니다. 배치된 것은
            전부 드래그·회전·크기조절로 수정할 수 있어요.
          </p>
          <textarea
            value={layoutPrompt}
            onChange={(e) => setLayoutPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                requestLayout();
              }
            }}
            disabled={busy || layoutBusy}
            placeholder="예: 원형 테이블 3개를 가운데 놓고 의자 12개를 극장식으로 배치해줘"
            rows={3}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
          />
          {layoutError && (
            <p className="mt-1 text-xs text-red-500">{layoutError}</p>
          )}
          <button
            onClick={requestLayout}
            disabled={busy || layoutBusy || !layoutPrompt.trim()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {layoutBusy && (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {layoutBusy ? "배치 계산 중…" : "AI로 배치하기"}
          </button>
        </div>

        {items.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
            배치된 구조물: <b>{items.length}개</b>
            <button
              onClick={() => {
                setItems([]);
                setSelectedId(null);
              }}
              disabled={busy}
              className="ml-3 text-xs text-red-500 hover:underline disabled:opacity-50"
            >
              전체 삭제
            </button>
          </div>
        )}

        {busy ? (
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
            <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
            <span className="text-sm text-gray-600">
              구조물을 공간에 자연스럽게 합성하고 있습니다… (수십 초 걸릴 수
              있어요)
            </span>
          </div>
        ) : (
          <button
            onClick={finalize}
            disabled={items.length === 0}
            className="rounded-lg bg-green-600 px-4 py-3 font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            최종 배치하기 ({items.length}개)
          </button>
        )}
      </aside>
    </div>
  );
}
