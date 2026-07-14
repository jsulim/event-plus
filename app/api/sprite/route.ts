import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import sharp from "sharp";

export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length > 40) {
      return NextResponse.json(
        { error: "구조물 이름(1~40자)을 입력해주세요." },
        { status: 400 }
      );
    }

    const prompt = `행사장에서 쓰는 "${trimmed}" 1개를 그린 실사풍 이미지.
완전한 투명 배경(transparent background)에 물체 하나만, 그림자 없음, 배경 요소 없음.
물체가 프레임 중앙에 크게 위치하고, 약간 비스듬한 3/4 시점(three-quarter view)으로 입체감이 보이게.`;

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "medium",
      background: "transparent",
      output_format: "png",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: "스프라이트 생성 결과가 비어 있습니다." },
        { status: 502 }
      );
    }

    // 전송량 절약: 768px WebP로 축소 (기존 스프라이트와 동일 규격)
    const webp = await sharp(Buffer.from(b64, "base64"))
      .resize(768, 768, { fit: "inside" })
      .webp({ quality: 92, alphaQuality: 95 })
      .toBuffer();

    return NextResponse.json({
      sprite: `data:image/webp;base64,${webp.toString("base64")}`,
    });
  } catch (err) {
    console.error("[/api/sprite] error:", err);
    const message =
      err instanceof Error
        ? err.message
        : "스프라이트 생성 중 알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
