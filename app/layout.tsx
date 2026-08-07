import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/QueryProvider";

export const metadata: Metadata = {
  title: "Robin Pickleball",
  description:
    "Xếp lịch và tính điểm buổi đánh pickleball theo thể thức Americano, tính điểm theo hiệu số.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
  // Không cho phóng to: người dùng bấm nút bằng ngón cái khi đang thở dốc, chạm
  // hai lần vô tình mà trang nhảy cỡ chữ thì rất khó chịu. Cỡ chữ đã đủ to sẵn.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
