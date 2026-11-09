import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenStudio · 연결 작업 공간",
  description: "영상 워크플로우를 위한 계정 연결, 모델 선택 및 실제 호출 검증.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" style={{ colorScheme: "dark" }}><body>{children}</body></html>;
}
