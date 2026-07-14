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

const KONTEXT_PROMPT = `Convert this event venue photo into an isometric cutaway 3D miniature rendering, viewed from above at an angle. Keep the room structure (walls, stage, doors, windows) and the arrangement, rows and approximate count of all furniture and fixtures the same. Clean presentation-quality 3D render style, soft lighting, black background. Do not add objects that are not in the photo.`;

/** fal.ai FLUX Kontext — 지시 기반 이미지 변환 (~15초) */
async function floorplanWithFal(imagePng: Buffer): Promise<Buffer> {
  const res = await fetch("https://fal.run/fal-ai/flux-pro/kontext", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: KONTEXT_PROMPT,
      image_url: `data:image/jpeg;base64,${imagePng.toString("base64")}`,
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

export async function POST(req: NextRequest) {
  try {
    const { image, engine } = (await req.json()) as {
      image?: string;
      engine?: "fast" | "quality";
    };

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

    // 빠름 모드: fal.ai FLUX Kontext (~15초), 실패 시 gpt-image-1 폴백
    if (engine !== "quality" && process.env.FAL_KEY) {
      try {
        // 업로드 크기 절감: fal 전송은 JPEG로 (PNG 대비 ~1/8)
        const jpeg = await sharp(resized).jpeg({ quality: 90 }).toBuffer();
        const converted = await floorplanWithFal(jpeg);
        const body: GenerateResponse = {
          resultImage: `data:image/png;base64,${converted.toString("base64")}`,
        };
        return NextResponse.json(body);
      } catch (falErr) {
        console.warn("[/api/floorplan] fal 실패, OpenAI로 폴백:", falErr);
      }
    }

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: await toFile(resized, "image.png", { type: "image/png" }),
      prompt: FLOORPLAN_PROMPT,
      size: "auto",
      quality: engine === "quality" ? "high" : "medium",
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
