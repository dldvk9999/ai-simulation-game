import type { Metadata, Viewport } from "next";
import { Gowun_Dodum } from "next/font/google";
import "./globals.css";

const gowun = Gowun_Dodum({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-gowun",
});

export const metadata: Metadata = {
  title: "무인도",
  description: "무인도에서 스스로 살아가는 사람들을 조용히 지켜보는 힐링 시뮬레이션",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f2a3f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={gowun.variable}>
      <body>{children}</body>
    </html>
  );
}
