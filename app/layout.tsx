import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/QueryProvider";
import { VersionBadge } from "@/components/VersionBadge";

/**
 * Archivo là phông của bản thiết kế. Nạp qua `next/font` chứ không qua `@import`
 * của CSS: cách kia chặn hiển thị cho tới khi tải xong phông từ máy chủ Google,
 * và ngoài sân thì mạng 4G chập chờn là chuyện thường.
 */
const archivo = Archivo({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "600", "800"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Robin Pickleball",
  description:
    "Xếp lịch và tính điểm buổi đánh pickleball theo thể thức Americano, tính điểm theo hiệu số.",
};

export const viewport: Viewport = {
  themeColor: "#201e1d",
  // Không cho phóng to: người dùng bấm nút bằng ngón cái khi đang thở dốc, chạm
  // hai lần vô tình mà trang nhảy cỡ chữ thì rất khó chịu. Cỡ chữ đã đủ to sẵn.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={archivo.variable}>
      <body>
        <QueryProvider>{children}</QueryProvider>
        <VersionBadge />
      </body>
    </html>
  );
}
