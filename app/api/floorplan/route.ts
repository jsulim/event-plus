import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { GenerateResponse } from "@/lib/types";

export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_DIM = 1536;

const FLOORPLAN_PROMPT = `이 행사 공간 사진을 아이소메트릭(쿼터뷰) 조감도 렌더링으로 변환해주세요.

요구사항:
- 공간 전체가 한눈에 보이는 미니어처 모형 스타일: 위에서 비스듬히 내려다보는 아이소메트릭 시점, 앞쪽 벽은 잘라낸 단면(cutaway)으로 표현
- 사진 속 공간의 구조(벽, 기둥, 출입구, 무대, 창문)와 가구·좌석·구조물의 배치, 줄 수, 대략적 개수를 최대한 그대로 유지
- 깔끔한 행사 제안서용 3D 렌더링 품질: 부드러운 조명, 정돈된 색감, 검은색 배경
- 사진에 없는 물체를 새로 추가하지 마세요`;

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
      prompt: FLOORPLAN_PROMPT,
      size: "auto",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: "조감도 생성 결과가 비어 있습니다." },
        { status: 502 }
      );
    }

    const body: GenerateResponse = {
      resultImage: `data:image/png;base64,${b64}`,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/floorplan] error:", err);
    const message =
      err instanceof Error
        ? err.message
        : "조감도 생성 중 알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
