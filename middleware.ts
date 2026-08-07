/**
 * Cấp danh tính thiết bị cho mọi lượt truy cập.
 *
 * Đặt ở middleware chứ không ở từng trang, để cookie có mặt ngay từ yêu cầu đầu
 * tiên — kể cả khi người chơi mở thẳng đường dẫn tham gia từ mã QR. Nếu chờ tới
 * lúc trang chạy mới cấp thì lượt đầu chưa có danh tính, và chính lượt đầu mới
 * là lúc cần nó.
 */

import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE } from "./lib/identity/device";

const ONE_YEAR = 365 * 24 * 60 * 60;

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (request.cookies.has(DEVICE_COOKIE)) return response;

  response.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
    // Cố ý KHÔNG đặt httpOnly: trình duyệt cần đọc được để gắn tên và ảnh đại
    // diện đang lưu ở localStorage vào đúng thiết bị. Đây không phải chứng chỉ
    // xác thực — quyền nhập điểm nằm ở cookie phiên riêng, có ký.
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR,
    path: "/",
  });
  return response;
}

export const config = {
  // Bỏ qua tệp tĩnh và ảnh: chúng không cần danh tính và chạy qua middleware chỉ
  // tổ tốn thời gian ở mỗi lượt tải.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
