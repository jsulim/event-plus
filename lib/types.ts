export type Classification = "remove" | "preserve" | "uncertain";

export interface DetectedObject {
  id: string;
  label: string;
  classification: Classification;
  /** 0~1 정규화 좌표 [x, y, width, height] (좌상단 기준) */
  bbox: [number, number, number, number];
  confidence: number;
}

export interface AnalyzeResponse {
  objects: DetectedObject[];
}

export interface GenerateResponse {
  resultImage: string;
}
