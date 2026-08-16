import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixel Local｜本地图片编辑器",
  description: "在浏览器本地完成图片、文字与 Logo 的轻量编辑和模板复用。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
