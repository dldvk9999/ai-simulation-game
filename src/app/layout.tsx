import type { Metadata, Viewport } from "next";
import { Gowun_Dodum } from "next/font/google";
import { InstallGuide } from "@/components/InstallButton";
import { installBoot } from "@/components/install-boot";
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
  applicationName: "무인도",
  appleWebApp: { capable: true, title: "무인도", statusBarStyle: "black" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f2a3f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={gowun.variable}>
      <head>
        {/* 브라우저 설치 창은 일찍 떠서 놓치기 쉽다: React 보다 먼저, HTML 을 읽는 즉시 실행 */}
        <script dangerouslySetInnerHTML={{ __html: installBoot(process.env.NODE_ENV === "production") }} />
      </head>
      <body>
        {children}
        <InstallGuide />
      </body>
    </html>
  );
}
