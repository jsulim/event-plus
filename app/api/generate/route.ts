import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { GenerateResponse } from "@/lib/types";

export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// gpt-image-1 입력 이미지가 너무 크면 업로드/처리 시간이 늘어나므로 최대 변 기준으로 축소
const MAX_DIM = 1536;

function buildEditPrompt(removeLabels: string[], preserveLabels: string[]) {
  const removeText =
    removeLabels.length > 0 ? removeLabels.join(", ") : "표시된 물체";
  let prompt = `마스크(투명 영역)로 표시된 위치에 있는 다음 물체들만 제거하세요: ${removeText}.
제거한 자리는 주변과 자연스럽게 이어지는 배경(벽, 바닥, 천장)으로 복원하세요.

중요: 마스크 사각형이 제거 대상 주변의 다른 물체와 겹칠 수 있습니다.
마스크에 일부가 걸쳤더라도 제거 대상이 아닌 물체는 지우지 말고, 가려졌던 부분까지 온전한 형태로 복원해서 그대로 유지하세요.`;
  if (preserveLabels.length > 0) {
    prompt += `\n특히 다음은 반드시 화면에 그대로 남아야 합니다: ${preserveLabels.join(", ")}.`;
  }
  prompt += `\n건축 구조(벽, 기둥, 창문, 조명, 바닥 패턴)는 원본 그대로 유지하고,
조명과 그림자도 주변 환경과 일관되게 표현하세요. 마스크 바깥 영역은 절대 변경하지 마세요.`;
  return prompt;
}

interface GenerateRequestBody {
  image?: string;
  /** 0~1 정규화 [x, y, width, height] 목록 */
  boxes?: [number, number, number, number][];
  /** 제거 대상 라벨 목록 (프롬프트 지시용) */
  removeLabels?: string[];
  /** 사용자가 보존으로 지정한 라벨 목록 (프롬프트 지시용) */
  preserveLabels?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const { image, boxes, removeLabels, preserveLabels } =
      (await req.json()) as GenerateRequestBody;

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
      // 경계 패딩: 박스 크기에 비례(5%) + 최소 0.3% — 주변 물체 침범 최소화
      const padX = bw * 0.05 + 0.003;
      const padY = bh * 0.05 + 0.003;
      const x0 = Math.max(0, Math.floor((bx - padX) * width));
      const y0 = Math.max(0, Math.floor((by - padY) * height));
      const x1 = Math.min(width, Math.ceil((bx + bw + padX) * width));
      const y1 = Math.min(height, Math.ceil((by + bh + padY) * height));
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
      prompt: buildEditPrompt(removeLabels ?? [], preserveLabels ?? []),
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
    console.error("[/api/generate] error:", err);
    const message =
      err instanceof Error ? err.message : "생성 중 알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
