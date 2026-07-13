import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { GenerateResponse } from "@/lib/types";

export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// gpt-image-1 입력 이미지가 너무 크면 업로드/처리 시간이 늘어나므로 최대 변 기준으로 축소
const MAX_DIM = 1536;

const EDIT_PROMPT = `마스크로 지정된 영역의 물체(사람, 가구, 배너, 행사 설치물 등)를 모두 제거하고,
그 자리를 주변과 자연스럽게 이어지는 배경(벽, 바닥, 천장)으로 복원해주세요.
건축 구조(벽, 기둥, 창문, 조명, 바닥 패턴)는 원본 그대로 유지하고,
조명과 그림자도 주변 환경과 일관되게 표현해주세요. 빈 공간 상태의 사진처럼 보여야 합니다.`;

interface GenerateRequestBody {
  image?: string;
  /** 0~1 정규화 [x, y, width, height] 목록 */
  boxes?: [number, number, number, number][];
}

export async function POST(req: NextRequest) {
  try {
    const { image, boxes } = (await req.json()) as GenerateRequestBody;

    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "image 필드에 data URL 형식의 이미지가 필요합니다." },
        { status: 400 }
      );
    }
    if (!boxes || boxes.length === 0) {
      return NextResponse.json(
        { error: "제거할 객체가 없습니다. 최소 1개의 bbox가 필요합니다." },
        { status: 400 }
      );
    }

    const inputBuffer = Buffer.from(image.split(",")[1], "base64");

    // 원본을 PNG로 변환 + 최대 변 제한으로 리사이즈
    const resized = await sharp(inputBuffer)
      .rotate() // EXIF 회전 반영
      .resize({
        width: MAX_DIM,
        height: MAX_DIM,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = resized.info;

    // 마스크 생성: 전체 불투명, 제거 영역만 알파 0 (OpenAI edits 규격:
    // "fully transparent areas indicate where the image should be edited")
    const mask = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      mask[i * 4 + 3] = 255; // opaque black
    }
    for (const [bx, by, bw, bh] of boxes) {
      // 경계를 약간(2%) 넓혀 물체 가장자리가 마스크 밖에 남는 것을 방지
      const pad = 0.02;
      const x0 = Math.max(0, Math.floor((bx - pad) * width));
      const y0 = Math.max(0, Math.floor((by - pad) * height));
      const x1 = Math.min(width, Math.ceil((bx + bw + pad) * width));
      const y1 = Math.min(height, Math.ceil((by + bh + pad) * height));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          mask[(y * width + x) * 4 + 3] = 0; // transparent = edit here
        }
      }
    }
    const maskPng = await sharp(mask, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: await toFile(resized.data, "image.png", { type: "image/png" }),
      mask: await toFile(maskPng, "mask.png", { type: "image/png" }),
      prompt: EDIT_PROMPT,
      size: "auto",
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
    console.error("[/api/generate] error:", err);
    const message =
      err instanceof Error ? err.message : "생성 중 알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
