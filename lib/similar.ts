// 사용자가 그린 영역과 시각적으로 유사한 영역을 이미지 전체에서 찾는다.
// 컬러(RGB) 정규화 상호상관(NCC) 기반 멀티스케일 템플릿 매칭.
// 전부 브라우저 연산이라 API 비용이 없다. 행사장처럼 동일한 물체(의자, 배너 등)가
// 반복되는 장면에 효과적이며, 결과는 "제안"이므로 사용자가 개별 삭제/토글로 다듬는다.

const TEMPLATE_SIDE = 32; // 템플릿을 이 크기(최대 변)로 축소해서 스캔
const SCORE_THRESHOLD = 0.48;
const NMS_IOU = 0.3;
const MAX_RESULTS = 40;
const STRIDE = 2;
const SCALES = [0.85, 1.0, 1.18]; // 원근으로 크기가 조금 다른 개체 대응

type Box = [number, number, number, number]; // 0~1 정규화 [x, y, w, h]

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

function iou(a: Hit, b: Hit): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
}

/** 캔버스에서 RGB 채널별 Float32 배열 추출 */
function rgbChannels(
  img: HTMLImageElement,
  w: number,
  h: number
): [Float32Array, Float32Array, Float32Array] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const r = new Float32Array(w * h);
  const g = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    r[i] = data[i * 4];
    g[i] = data[i * 4 + 1];
    b[i] = data[i * 4 + 2];
  }
  return [r, g, b];
}

export async function findSimilarRegions(
  imageDataUrl: string,
  templateBox: Box
): Promise<Box[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = imageDataUrl;
  });

  const [bx, by, bw, bh] = templateBox;
  const templW = bw * img.naturalWidth;
  const templH = bh * img.naturalHeight;
  if (templW < 8 || templH < 8) return [];

  const hits: Hit[] = [];

  for (const scale of SCALES) {
    let s = (TEMPLATE_SIDE / Math.max(templW, templH)) * scale;
    s = Math.min(s, 1);
    const W = Math.max(16, Math.round(img.naturalWidth * s));
    const H = Math.max(16, Math.round(img.naturalHeight * s));
    if (W * H > 1_500_000) continue;

    const ch = rgbChannels(img, W, H);

    const tw = Math.max(4, Math.round(bw * W));
    const th = Math.max(4, Math.round(bh * H));
    const tx = Math.min(W - tw, Math.round(bx * W));
    const ty = Math.min(H - th, Math.round(by * H));
    const n = tw * th;
    const n3 = 3 * n;

    // 템플릿: 3채널 연결 벡터 기준 zero-mean
    let tMean = 0;
    for (const a of ch)
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) tMean += a[(ty + y) * W + (tx + x)];
    tMean /= n3;
    const t: Float32Array[] = [
      new Float32Array(n),
      new Float32Array(n),
      new Float32Array(n),
    ];
    let tVar = 0;
    for (let c = 0; c < 3; c++)
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          const v = ch[c][(ty + y) * W + (tx + x)] - tMean;
          t[c][y * tw + x] = v;
          tVar += v * v;
        }
    const tStd = Math.sqrt(tVar / n3);
    if (tStd < 4) continue; // 밋밋한 템플릿(단색 벽 등)은 오탐만 만든다

    // 3채널 합산 적분영상으로 창 평균/분산 O(1) 계산
    const ii = new Float64Array((W + 1) * (H + 1));
    const ii2 = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rs = 0;
      let rs2 = 0;
      for (let x = 0; x < W; x++) {
        const v0 = ch[0][y * W + x];
        const v1 = ch[1][y * W + x];
        const v2 = ch[2][y * W + x];
        rs += v0 + v1 + v2;
        rs2 += v0 * v0 + v1 * v1 + v2 * v2;
        ii[(y + 1) * (W + 1) + (x + 1)] = ii[y * (W + 1) + (x + 1)] + rs;
        ii2[(y + 1) * (W + 1) + (x + 1)] = ii2[y * (W + 1) + (x + 1)] + rs2;
      }
    }
    const windowSum = (arr: Float64Array, x: number, y: number) =>
      arr[(y + th) * (W + 1) + (x + tw)] -
      arr[y * (W + 1) + (x + tw)] -
      arr[(y + th) * (W + 1) + x] +
      arr[y * (W + 1) + x];

    for (let y = 0; y + th <= H; y += STRIDE) {
      for (let x = 0; x + tw <= W; x += STRIDE) {
        const wMean = windowSum(ii, x, y) / n3;
        const wVar = windowSum(ii2, x, y) / n3 - wMean * wMean;
        if (wVar < 16) continue;
        let dot = 0;
        for (let c = 0; c < 3; c++) {
          const a = ch[c];
          const tc = t[c];
          for (let yy = 0; yy < th; yy++) {
            const rowOff = (y + yy) * W + x;
            const tOff = yy * tw;
            for (let xx = 0; xx < tw; xx++) {
              dot += (a[rowOff + xx] - wMean) * tc[tOff + xx];
            }
          }
        }
        const score = dot / (n3 * Math.sqrt(wVar) * tStd);
        if (score >= SCORE_THRESHOLD) {
          hits.push({ x: x / W, y: y / H, w: tw / W, h: th / H, score });
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const template: Hit = { x: bx, y: by, w: bw, h: bh, score: 1 };
  const kept: Hit[] = [];
  for (const h of hits) {
    if (iou(h, template) > NMS_IOU) continue;
    if (kept.some((k) => iou(k, h) > NMS_IOU)) continue;
    kept.push(h);
    if (kept.length >= MAX_RESULTS) break;
  }

  return kept.map((h) => [h.x, h.y, h.w, h.h] as Box);
}
