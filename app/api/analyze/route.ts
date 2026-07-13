import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { AnalyzeResponse, DetectedObject } from "@/lib/types";

export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `당신은 행사 공간 사진을 분석하는 전문가입니다.
사진 속에서 눈에 띄는 물체들을 탐지하고, 아래 기준에 따라 분류하세요.

**제거 대상(remove)**: 사람, 의자, 테이블, 소파, 배너, 현수막, 전시대, 행사 부스, 포토월, 이동식 안내데스크, 이동식 무대, 음향장비, 스탠드형 조명, 모니터, 이동식 스크린, 박스, 케이블, 카트, 쓰레기통, 장식물, 임시 가설물

**보존 대상(preserve)**: 벽, 바닥, 천장, 기둥, 창문, 출입구, 계단, 엘리베이터, 매립조명, 고정형 천장조명, 고정형 무대, 빌트인 가구, 소방시설, 콘센트, 고정형 안내데스크, 건축 구조 일반

**확인 필요(uncertain)**: 파티션, 트러스, 무대, 대형 모니터, 스크린, 안내데스크, 대형 화분, 장기 설치 전시물, 장식 구조물, 반고정형 벽체, 고정 여부 판단 어려운 설치물

목록에 없는 새로운 물체를 만나면: 이동 가능해 보이면 remove, 건축 구조물이면 preserve, 애매하면 uncertain으로 분류하세요.

각 물체마다:
- label: 한국어 명칭 (예: "의자", "배너")
- classification: remove | preserve | uncertain
- bbox: [x, y, width, height] — 이미지 좌상단 기준 0~1 정규화 비율 좌표. 물체 전체를 타이트하게 감싸도록.
- confidence: 0~1 사이 탐지 확신도

같은 종류 물체가 여러 개면 각각 개별 항목으로 탐지하되, 매우 많으면(예: 의자 수십 개) 인접한 것끼리 묶어 하나의 bbox로 표현해도 됩니다.
벽/바닥/천장 같은 배경 구조는 별도 항목으로 넣지 마세요. 사진 위에 오버레이할 가치가 있는 뚜렷한 물체 위주로 탐지하세요.`;

const JSON_SCHEMA = {
  name: "detected_objects",
  strict: true,
  schema: {
    type: "object",
    properties: {
      objects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            classification: {
              type: "string",
              enum: ["remove", "preserve", "uncertain"],
            },
            bbox: {
              type: "array",
              items: { type: "number" },
              minItems: 4,
              maxItems: 4,
            },
            confidence: { type: "number" },
          },
          required: ["label", "classification", "bbox", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["objects"],
    additionalProperties: false,
  },
} as const;

export async function POST(req: NextRequest) {
  try {
    const { image } = (await req.json()) as { image?: string };
    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "image 필드에 data URL 형식의 이미지가 필요합니다." },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "이 행사 공간 사진에서 물체를 탐지하고 분류해주세요.",
            },
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

    const parsed = JSON.parse(raw) as {
      objects: Omit<DetectedObject, "id">[];
    };

    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
    const objects: DetectedObject[] = parsed.objects.map((o, i) => {
      const [x, y, w, h] = o.bbox;
      const cx = clamp01(x);
      const cy = clamp01(y);
      return {
        id: `obj_${i + 1}`,
        label: o.label,
        classification: o.classification,
        bbox: [cx, cy, clamp01(Math.min(w, 1 - cx)), clamp01(Math.min(h, 1 - cy))],
        confidence: clamp01(o.confidence),
      };
    });

    const body: AnalyzeResponse = { objects };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/analyze] error:", err);
    const message =
      err instanceof Error ? err.message : "분석 중 알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
