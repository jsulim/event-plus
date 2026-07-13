// YOLO(인스턴스 검출) 결과와 GPT(도메인 물체) 결과 병합.
// GPT가 사람·의자 무리를 하나의 큰 박스로 뭉뚱그린 경우를 걸러낸다.
import type { DetectedObject } from "./types";
import { YOLO_COVERED_LABELS } from "./yolo";

function iou(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const ix = Math.max(
    0,
    Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  );
  const iy = Math.max(
    0,
    Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  );
  const inter = ix * iy;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9);
}

export function mergeDetections(
  yolo: Omit<DetectedObject, "id">[],
  gpt: DetectedObject[]
): DetectedObject[] {
  const yoloObjs: DetectedObject[] = yolo.map((o, i) => ({
    ...o,
    id: `yolo_${i + 1}`,
  }));
  const centers = yoloObjs.map(
    (o) =>
      [o.bbox[0] + o.bbox[2] / 2, o.bbox[1] + o.bbox[3] / 2] as [number, number]
  );

  const filteredGpt = gpt.filter((g) => {
    // YOLO가 담당하는 종류는 GPT 결과에서 제외 (중복/뭉뚱그림 방지)
    if (YOLO_COVERED_LABELS.test(g.label)) return false;
    const [gx, gy, gw, gh] = g.bbox;
    // YOLO 개별 박스 3개 이상을 포함하는 큰 박스 = 무리를 뭉뚱그린 것
    let inside = 0;
    for (const [cx, cy] of centers) {
      if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
        if (++inside >= 3) return false;
      }
    }
    // 개별 YOLO 박스와 사실상 같은 물체면 YOLO 쪽을 신뢰
    for (const y of yoloObjs) {
      if (iou(g.bbox, y.bbox) > 0.45) return false;
    }
    return true;
  });

  return [
    ...yoloObjs,
    ...filteredGpt.map((g, i) => ({ ...g, id: `gpt_${i + 1}` })),
  ];
}
