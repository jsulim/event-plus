import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "이벤트플러스 — AI 행사 공간 시뮬레이터",
  description:
    "행사장 사진 한 장으로 빈 공간 생성부터 구조물 배치, 제안용 조감도까지. 이벤트플러스의 행사 데이터로 학습된 AI 공간 시뮬레이터.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
