// 브라우저에서 YOLOX-S(ONNX, Apache-2.0)로 인스턴스 단위 객체 탐지.
// COCO 80클래스 중 행사 공간과 관련된 클래스만 골라 remove/uncertain으로 매핑한다.
// 배너·부스·무대 등 COCO에 없는 도메인 물체는 /api/analyze(GPT)가 담당.
import type { Classification, DetectedObject } from "./types";

const MODEL_URL = "/models/yolox_s.onnx";
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const NMS_IOU = 0.45;

const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
  "truck", "boat", "traffic light", "fire hydrant", "stop sign",
  "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag",
  "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
  "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon",
  "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
  "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
  "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
  "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
  "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
];

const CLASS_MAP: Record<string, { label: string; classification: Classification }> = {
  person: { label: "사람", classification: "remove" },
  chair: { label: "의자", classification: "remove" },
  couch: { label: "소파", classification: "remove" },
  bench: { label: "벤치", classification: "remove" },
  "dining table": { label: "테이블", classification: "remove" },
  tv: { label: "모니터/스크린", classification: "remove" },
  laptop: { label: "노트북", classification: "remove" },
  "potted plant": { label: "화분", classification: "uncertain" },
  suitcase: { label: "캐리어", classification: "remove" },
  backpack: { label: "가방", classification: "remove" },
  handbag: { label: "가방", classification: "remove" },
};

/** YOLO가 담당하는 라벨 — GPT 결과에서 이 계열은 걸러낸다 */
export const YOLO_COVERED_LABELS =
  /사람|인물|관객|참석자|의자|체어|좌석|테이블|탁자|소파|벤치|모니터|스크린|TV|노트북|화분|가방|캐리어/;

interface RawBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  score: number;
  classIdx: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionPromise: Promise<any> | null = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths = "/ort/";
      ort.env.wasm.numThreads = 1;
      return ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
      });
    })();
  }
  return sessionPromise;
}

/** 모델 파일을 미리 받아 세션을 준비 (업로드 직후 호출해두면 분석이 빨라짐) */
export function warmupYolo() {
  getSession().catch(() => {
    sessionPromise = null;
  });
}

function iou(a: RawBox, b: RawBox): number {
  const ix0 = Math.max(a.x0, b.x0);
  const iy0 = Math.max(a.y0, b.y0);
  const ix1 = Math.min(a.x1, b.x1);
  const iy1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / (areaA + areaB - inter + 1e-9);
}

/** 클래스별 NMS */
function nms(boxes: RawBox[]): RawBox[] {
  const kept: RawBox[] = [];
  const byClass = new Map<number, RawBox[]>();
  for (const b of boxes) {
    const list = byClass.get(b.classIdx) ?? [];
    list.push(b);
    byClass.set(b.classIdx, list);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => b.score - a.score);
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      kept.push(list[i]);
      for (let j = i + 1; j < list.length; j++) {
        if (!used[j] && iou(list[i], list[j]) > NMS_IOU) used[j] = true;
      }
    }
  }
  return kept;
}

/**
 * 이미지(dataURL)에서 객체를 인스턴스 단위로 탐지.
 * 반환 bbox는 0~1 정규화 [x, y, w, h].
 */
export async function detectWithYolo(
  imageDataUrl: string
): Promise<Omit<DetectedObject, "id">[]> {
  const [session, img] = await Promise.all([
    getSession(),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imageDataUrl;
    }),
  ]);

  // letterbox 전처리: 비율 유지 축소 후 114로 패딩 (YOLOX 규격, 정규화 없이 0~255)
  const ratio = Math.min(
    INPUT_SIZE / img.naturalWidth,
    INPUT_SIZE / img.naturalHeight
  );
  const scaledW = Math.round(img.naturalWidth * ratio);
  const scaledH = Math.round(img.naturalHeight * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(img, 0, 0, scaledW, scaledH);
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  // RGBA → BGR CHW float32 (YOLOX 릴리스 모델은 BGR·비정규화 입력)
  const n = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = data[i * 4 + 2]; // B
    input[n + i] = data[i * 4 + 1]; // G
    input[2 * n + i] = data[i * 4]; // R
  }

  const ort = await import("onnxruntime-web");
  const tensor = new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const out = outputs[session.outputNames[0]];
  const pred = out.data as Float32Array;
  const numAnchors = out.dims[1] as number; // 8400
  const stride5 = out.dims[2] as number; // 85 = 4 box + 1 obj + 80 cls

  // 앵커 그리드 복원 (stride 8/16/32)
  const boxes: RawBox[] = [];
  let anchorIdx = 0;
  for (const stride of [8, 16, 32]) {
    const gsize = INPUT_SIZE / stride;
    for (let gy = 0; gy < gsize; gy++) {
      for (let gx = 0; gx < gsize; gx++, anchorIdx++) {
        const off = anchorIdx * stride5;
        const obj = pred[off + 4];
        if (obj < CONF_THRESHOLD * 0.5) continue;
        let best = 0;
        let bestIdx = -1;
        for (let c = 0; c < 80; c++) {
          const s = pred[off + 5 + c];
          if (s > best) {
            best = s;
            bestIdx = c;
          }
        }
        const score = obj * best;
        if (score < CONF_THRESHOLD) continue;
        if (!CLASS_MAP[COCO_CLASSES[bestIdx]]) continue;

        const cx = (pred[off] + gx) * stride;
        const cy = (pred[off + 1] + gy) * stride;
        const w = Math.exp(pred[off + 2]) * stride;
        const h = Math.exp(pred[off + 3]) * stride;
        boxes.push({
          x0: cx - w / 2,
          y0: cy - h / 2,
          x1: cx + w / 2,
          y1: cy + h / 2,
          score,
          classIdx: bestIdx,
        });
      }
    }
  }
  if (anchorIdx !== numAnchors) {
    console.warn(`[yolo] anchor mismatch: ${anchorIdx} != ${numAnchors}`);
  }

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return nms(boxes).map((b) => {
    const m = CLASS_MAP[COCO_CLASSES[b.classIdx]];
    // letterbox 좌표 → 원본 정규화 좌표
    const x = clamp01(b.x0 / ratio / img.naturalWidth);
    const y = clamp01(b.y0 / ratio / img.naturalHeight);
    const x1 = clamp01(b.x1 / ratio / img.naturalWidth);
    const y1 = clamp01(b.y1 / ratio / img.naturalHeight);
    return {
      label: m.label,
      classification: m.classification,
      bbox: [x, y, x1 - x, y1 - y] as [number, number, number, number],
      confidence: Math.round(b.score * 100) / 100,
    };
  });
}
