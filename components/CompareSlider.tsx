"use client";

import { useRef, useState } from "react";

interface Props {
  before: string;
  after: string;
}

export default function CompareSlider({ before, after }: Props) {
  const [pos, setPos] = useState(50); // %
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-ew-resize select-none overflow-hidden rounded-lg"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        handleMove(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) handleMove(e.clientX);
      }}
    >
      {/* After (아래 전체) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="After" className="block w-full" draggable={false} />
      {/* Before (위, 클립) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={before}
          alt="Before"
          className="block w-full"
          draggable={false}
        />
      </div>
      {/* 핸들 */}
      <div
        className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(0,0,0,0.5)]"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm font-bold text-gray-700 shadow">
          ⇔
        </div>
      </div>
      <span className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        Before
      </span>
      <span className="absolute top-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        After
      </span>
    </div>
  );
}
