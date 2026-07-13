"use client";

import { useRef, useState } from "react";
import type { Classification, DetectedObject } from "@/lib/types";

const STYLE: Record<
  Classification,
  { border: string; bg: string; label: string }
> = {
  remove: {
    border: "border-red-500",
    bg: "bg-red-500/25",
    label: "bg-red-500",
  },
  preserve: {
    border: "border-blue-500",
    bg: "bg-blue-500/25",
    label: "bg-blue-500",
  },
  uncertain: {
    border: "border-yellow-500",
    bg: "bg-yellow-400/30",
    label: "bg-yellow-500",
  },
};

interface Props {
  image: string;
  objects: DetectedObject[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** true면 드래그로 새 영역을 그리는 모드 */
  drawMode?: boolean;
  /** 드래그로 그린 bbox([x,y,w,h], 0~1 정규화)를 전달 */
  onDraw?: (bbox: [number, number, number, number]) => void;
}

export default function ImageAnnotator({
  image,
  objects,
  selectedId,
  onSelect,
  drawMode = false,
  onDraw,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawStart, setDrawStart] = useState<[number, number] | null>(null);
  const [drawRect, setDrawRect] = useState<
    [number, number, number, number] | null
  >(null);

  const toFraction = (clientX: number, clientY: number): [number, number] => {
    const rect = containerRef.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    ];
  };

  const rectFrom = (
    a: [number, number],
    b: [number, number]
  ): [number, number, number, number] => {
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    return [x, y, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
  };

  return (
    <div ref={containerRef} className="relative inline-block w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt="분석 대상 이미지"
        className="w-full rounded-lg select-none"
        draggable={false}
      />
      {objects.map((obj) => {
        const [x, y, w, h] = obj.bbox;
        const s = STYLE[obj.classification];
        const selected = obj.id === selectedId;
        return (
          <button
            key={obj.id}
            type="button"
            onClick={() => onSelect(selected ? null : obj.id)}
            className={`absolute border-2 ${s.border} ${s.bg} transition-all ${
              selected ? "ring-4 ring-white/80 z-10" : ""
            }`}
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${w * 100}%`,
              height: `${h * 100}%`,
            }}
            title={obj.label}
          >
            <span
              className={`absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white ${s.label} ${
                selected ? "" : "opacity-90"
              }`}
            >
              {obj.label}
            </span>
          </button>
        );
      })}

      {/* 직접 그리기 모드: 기존 박스 클릭을 막는 캡처 레이어 */}
      {drawMode && (
        <div
          className="absolute inset-0 z-20 cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const p = toFraction(e.clientX, e.clientY);
            setDrawStart(p);
            setDrawRect([p[0], p[1], 0, 0]);
          }}
          onPointerMove={(e) => {
            if (!drawStart) return;
            setDrawRect(rectFrom(drawStart, toFraction(e.clientX, e.clientY)));
          }}
          onPointerUp={() => {
            if (drawRect && drawRect[2] > 0.015 && drawRect[3] > 0.015) {
              onDraw?.(drawRect);
            }
            setDrawStart(null);
            setDrawRect(null);
          }}
          onPointerCancel={() => {
            setDrawStart(null);
            setDrawRect(null);
          }}
        >
          {drawRect && (
            <div
              className="absolute border-2 border-dashed border-red-500 bg-red-500/20"
              style={{
                left: `${drawRect[0] * 100}%`,
                top: `${drawRect[1] * 100}%`,
                width: `${drawRect[2] * 100}%`,
                height: `${drawRect[3] * 100}%`,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
