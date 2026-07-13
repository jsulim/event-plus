// onnxruntime-web의 wasm 런타임 파일을 public/ort/로 복사 (predev/prebuild에서 실행)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "node_modules", "onnxruntime-web", "dist");
const dst = path.join(root, "public", "ort");

fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (f.endsWith(".wasm") || f.endsWith(".mjs")) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}
console.log("copied onnxruntime-web wasm runtime to public/ort/");
