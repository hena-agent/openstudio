import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenStudio · 모델 작업 공간",
  description: "텍스트·음성·이미지·영상 모델을 연결하고 실행하는 영상 제작 작업 공간.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" style={{ colorScheme: "dark" }}><body>{children}</body></html>;
}
