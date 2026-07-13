import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `당신은 행사 공간 배치 전문가입니다. 사용자가 공간 사진과 함께 배치 지시를 주면,
사용 가능한 구조물을 사진 속 공간에 어울리게 배치한 좌표 목록을 반환하세요.

사용 가능한 구조물 종류(type)와 실제 크기 감각:
- chair: 연회용 의자 1개 (폭 약 0.5m)
- table: 원형 연회 테이블 1개 (지름 약 1.5m)
- booth: 전시 부스 1개 (약 3m x 3m)
- stage: 이동식 무대 (약 4~6m 폭)
- banner: 롤업 배너 스탠드 1개 (폭 약 0.8m, 세로로 긴 형태)

좌표 규칙:
- x, y: 구조물 중심의 위치. 이미지 좌상단 (0,0) ~ 우하단 (1,1) 정규화 좌표
- w: 구조물 너비 (이미지 너비 대비 비율)
- rot: 시계방향 회전 각도(도). 대부분 0이 자연스러움

배치 원칙:
- 사진을 보고 바닥 영역에만 배치하세요. 구조물이 벽이나 천장에 떠 있으면 안 됩니다.
- 원근을 반영하세요: 사진에서 멀리 있는 위치(대체로 y가 작은 바닥 쪽)는 w를 작게, 가까운 위치는 크게.
  참고 기준: 화면 가까운 바닥(y≈0.85)에서 의자 w≈0.1, 테이블 w≈0.2, 부스 w≈0.3, 무대 w≈0.35, 배너 w≈0.08.
  멀어질수록 이 값을 비례해서 줄이세요.
- "극장식", "연회식" 같은 배치 용어를 알고 있다면 그 관례대로 정렬하세요 (극장식 = 의자를 행렬로 정렬).
- 구조물끼리 과하게 겹치지 않게 하되, 의자 열처럼 촘촘한 배치는 괜찮습니다.
- 지시에 개수가 있으면 정확히 그 개수만큼, 없으면 공간에 맞는 적절한 개수로.
- 최대 80개까지만 배치하세요.`;

const JSON_SCHEMA = {
  name: "layout_placements",
  strict: true,
  schema: {
    type: "object",
    properties: {
      placements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["chair", "table", "booth", "stage", "banner"],
            },
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            rot: { type: "number" },
          },
          required: ["type", "x", "y", "w", "rot"],
          additionalProperties: false,
        },
      },
    },
    required: ["placements"],
    additionalProperties: false,
  },
} as const;

export async function POST(req: NextRequest) {
  try {
    const { image, prompt } = (await req.json()) as {
      image?: string;
      prompt?: string;
    };

    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "image 필드에 data URL 형식의 이미지가 필요합니다." },
        { status: 400 }
      );
    }
    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: "배치 지시(prompt)를 입력해주세요." },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 8192,
      response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `배치 지시: ${prompt.trim()}` },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json(
        { error: "모델이 빈 응답을 반환했습니다." },
        { status: 502 }
      );
    }

    const clamp = (n: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, n));
    const parsed = JSON.parse(raw) as {
      placements: {
        type: string;
        x: number;
        y: number;
        w: number;
        rot: number;
      }[];
    };

    const placements = parsed.placements.slice(0, 80).map((p) => ({
      type: p.type,
      x: clamp(p.x, 0, 1),
      y: clamp(p.y, 0, 1),
      w: clamp(p.w, 0.02, 0.9),
      rot: clamp(p.rot, -180, 180),
    }));

    return NextResponse.json({ placements });
  } catch (err) {
    console.error("[/api/layout] error:", err);
    const message =
      err instanceof Error
        ? err.message
        : "배치 계산 중 알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
