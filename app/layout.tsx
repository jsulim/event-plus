import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "이벤트플러스 — 빈 공간 생성기",
  description:
    "행사 공간 사진에서 임시 설치물을 AI로 탐지하고 제거된 빈 공간 이미지를 생성합니다.",
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
