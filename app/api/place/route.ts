import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { GenerateResponse } from "@/lib/types";

export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_DIM = 1536;

const PLACE_PROMPT = `이 이미지는 실제 공간 사진 위에 행사 구조물 그림(의자, 테이블, 부스, 무대, 배너 등)을 임시로 합성한 것입니다.
합성된 구조물들을 각각 지금 놓인 위치, 크기, 방향을 그대로 유지하면서,
이 공간의 원근(perspective), 조명, 그림자에 자연스럽게 어울리는 실사 스타일로 다시 그려주세요.
바닥에 닿는 부분에는 자연스러운 그림자를 추가하세요.
배경 공간(벽, 바닥, 천장, 기둥, 조명)은 원본 그대로 유지하고, 구조물을 추가로 만들어 넣지 마세요.`;

export async function POST(req: NextRequest) {
  try {
    const { image } = (await req.json()) as { image?: string };

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
      .toBuffer();

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: await toFile(resized, "image.png", { type: "image/png" }),
      prompt: PLACE_PROMPT,
      size: "auto",
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
