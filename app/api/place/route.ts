import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { GenerateResponse } from "@/lib/types";

export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_DIM = 1536;

const PLACE_PROMPT = `이 이미지는 실제 공간 사진 위에 행사 구조물 그림(의자, 테이블, 부스, 무대, 배너 등)을 임시로 합성한 것입니다.
합성된 구조물들을 각각 지금 놓인 위치, 크기, 방향을 그대로 유지하면서,
이 공간의 원근(perspective), 조명, 그림자에 자연스럽게 어울리는 실사 스타일로 다시 그려주세요.
바닥에 닿는 부분에는 자연스러운 그림자를 추가하세요.
배경 공간(벽, 바닥, 천장, 기둥, 조명)은 원본 그대로 유지하고, 구조물을 추가로 만들어 넣지 마세요.`;

const KONTEXT_PLACE_PROMPT = `This photo has furniture/structure cutouts composited onto a real venue photo.
Redraw the composited objects as photorealistic, matching the room's perspective and lighting, and add natural floor shadows.
Keep each object at exactly the same position, size and orientation. Do not change the room background and do not add new objects.`;

interface PlaceRequestBody {
  image?: string;
  /** "fast" = fal Kontext(기본) / "quality" = gpt-image-1 고품질 */
  engine?: "fast" | "quality";
  /** 배치된 구조물들의 bbox (0~1 정규화 [x,y,w,h]) — 배경 보존 합성용 */
  boxes?: [number, number, number, number][];
}

/** fal.ai FLUX Kontext 호출 → 결과 버퍼 */
async function kontextRedraw(imageJpeg: Buffer): Promise<Buffer> {
  const res = await fetch("https://fal.run/fal-ai/flux-pro/kontext", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: KONTEXT_PLACE_PROMPT,
      image_url: `data:image/jpeg;base64,${imageJpeg.toString("base64")}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`fal kontext 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    images?: { url?: string }[];
    image?: { url?: string };
  };
  const url = data.images?.[0]?.url ?? data.image?.url;
  if (!url) throw new Error("fal kontext 응답에 이미지가 없습니다.");
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`fal 결과 다운로드 실패 (${imgRes.status})`);
  return Buffer.from(await imgRes.arrayBuffer());
}

/**
 * Kontext 결과에서 구조물 영역만 취하고 나머지는 원본 픽셀로 되돌린다.
 * 모델이 배경(바닥 재질 등)을 바꿔도 구조물 밖은 원본이 보장된다.
 */
async function compositePreservingBackground(
  originalPng: Buffer,
  redrawn: Buffer,
  boxes: [number, number, number, number][],
  width: number,
  height: number
): Promise<Buffer> {
  // 결과를 원본 크기로 맞춤 (Kontext는 출력 해상도가 다를 수 있음)
  const redrawnResized = await sharp(redrawn)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .toBuffer();

  // 구조물 영역 + 그림자 여유(아래쪽 확장) 마스크, 경계는 블러로 페더링
  const mask = Buffer.alloc(width * height, 0);
  for (const [bx, by, bw, bh] of boxes) {
    const padX = bw * 0.12 + 0.008;
    const padTop = bh * 0.08 + 0.005;
    const padBottom = bh * 0.25 + 0.01; // 바닥 그림자가 생길 공간
    const x0 = Math.max(0, Math.floor((bx - padX) * width));
    const y0 = Math.max(0, Math.floor((by - padTop) * height));
    const x1 = Math.min(width, Math.ceil((bx + bw + padX) * width));
    const y1 = Math.min(height, Math.ceil((by + bh + padBottom) * height));
    for (let y = y0; y < y1; y++) mask.fill(255, y * width + x0, y * width + x1);
  }
  const feathered = await sharp(mask, {
    raw: { width, height, channels: 1 },
  })
    .blur(Math.max(2, Math.round(Math.min(width, height) * 0.008)))
    .toBuffer();

  // 마스크를 알파로 얹어 원본 위에 합성
  const redrawnWithAlpha = await sharp(redrawnResized, {
    raw: { width, height, channels: 3 },
  })
    .joinChannel(feathered, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(originalPng)
    .composite([{ input: redrawnWithAlpha }])
    .png()
    .toBuffer();
}

export async function POST(req: NextRequest) {
  try {
    const { image, engine, boxes } = (await req.json()) as PlaceRequestBody;

    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "image 필드에 data URL 형식의 이미지가 필요합니다." },
        { status: 400 }
      );
    }

    const inputBuffer = Buffer.from(image.split(",")[1], "base64");

    const resized = await sharp(inputBuffer)
      .resize({
        width: MAX_DIM,
        height: MAX_DIM,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = resized.info;

    // 빠름 모드: fal Kontext 실사화 + 구조물 영역만 취하는 배경 보존 합성
    if (engine !== "quality" && process.env.FAL_KEY && boxes && boxes.length > 0) {
      try {
        const jpeg = await sharp(resized.data).jpeg({ quality: 90 }).toBuffer();
        const redrawn = await kontextRedraw(jpeg);
        const merged = await compositePreservingBackground(
          resized.data,
          redrawn,
          boxes,
          width,
          height
        );
        const body: GenerateResponse = {
          resultImage: `data:image/png;base64,${merged.toString("base64")}`,
        };
        return NextResponse.json(body);
      } catch (falErr) {
        console.warn("[/api/place] fal 실패, OpenAI로 폴백:", falErr);
      }
    }

    // 폴백: gpt-image-1 (배경 보존은 input_fidelity: high에 의존)
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: await toFile(resized.data, "image.png", { type: "image/png" }),
      prompt: PLACE_PROMPT,
      size: "auto",
      quality: engine === "quality" ? "high" : "medium",
      input_fidelity: "high",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: "이미지 생성 결과가 비어 있습니다." },
        { status: 502 }
      );
    }

    const body: GenerateResponse = {
      resultImage: `data:image/png;base64,${b64}`,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/place] error:", err);
    const message =
      err instanceof Error ? err.message : "배치 중 알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
