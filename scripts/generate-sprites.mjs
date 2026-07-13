// 구조물 팔레트용 투명배경 스프라이트를 gpt-image-1로 생성해 public/sprites/에 저장
// 실행: node scripts/generate-sprites.mjs
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");

// .env.local에서 키 로드
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
const apiKey = env.match(/OPENAI_API_KEY\s*=\s*(\S+)/)?.[1];
if (!apiKey) throw new Error("OPENAI_API_KEY not found in .env.local");

const openai = new OpenAI({ apiKey });

const COMMON =
  "완전한 투명 배경(transparent background)에 물체 하나만 그린 실사풍 이미지. " +
  "그림자 없음, 배경 요소 없음, 물체가 프레임 중앙에 크게 위치. " +
  "약간 비스듬한 3/4 시점(three-quarter view)으로 입체감이 보이게.";

const SPRITES = [
  {
    name: "chair",
    prompt: `행사장에서 쓰는 흰색 커버가 씌워진 연회용 의자(banquet chair) 1개. ${COMMON}`,
  },
  {
    name: "table",
    prompt: `흰색 테이블보가 덮인 원형 연회 테이블(round banquet table) 1개. ${COMMON}`,
  },
  {
    name: "booth",
    prompt: `전시회용 소형 부스 1개 — 흰색 프레임 구조에 상단 간판과 안내 카운터가 있는 3x3m 조립식 전시 부스. ${COMMON}`,
  },
  {
    name: "stage",
    prompt: `행사용 이동식 무대 1개 — 검은색 스커트가 둘러진 낮은 직사각형 무대 플랫폼. ${COMMON}`,
  },
  {
    name: "banner",
    prompt: `롤업 배너 스탠드(roll-up banner stand) 1개 — 은색 받침대 위에 세워진 세로형 배너, 배너 면은 단순한 파란색 그라데이션 디자인. ${COMMON}`,
  },
];

const outDir = path.join(root, "public", "sprites");
fs.mkdirSync(outDir, { recursive: true });

for (const { name, prompt } of SPRITES) {
  const outPath = path.join(outDir, `${name}.webp`);
  if (fs.existsSync(outPath)) {
    console.log(`skip (exists): ${name}`);
    continue;
  }
  console.log(`generating: ${name} ...`);
  const res = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    quality: "medium",
    background: "transparent",
    output_format: "png",
  });
  const png = Buffer.from(res.data[0].b64_json, "base64");
  await sharp(png)
    .resize(768, 768, { fit: "inside" })
    .webp({ quality: 92, alphaQuality: 95 })
    .toFile(outPath);
  console.log(`saved: ${outPath}`);
}
console.log("done");
