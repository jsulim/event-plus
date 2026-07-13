"use client";

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
}

export default function ImageAnnotator({
  image,
  objects,
  selectedId,
  onSelect,
}: Props) {
  return (
    <div className="relative inline-block w-full">
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
    </div>
  );
}
