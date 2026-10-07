import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "同行账本 · 让旅行只留下好回忆",
  description: "和朋友一起记录旅行花费，公平分账，轻松结算。",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
