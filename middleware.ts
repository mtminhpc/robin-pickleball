/**
 * Cấp danh tính thiết bị cho mọi lượt truy cập.
 *
 * Đặt ở middleware chứ không ở từng trang, để cookie có mặt ngay từ yêu cầu đầu
 * tiên — kể cả khi người chơi mở thẳng đường dẫn tham gia từ mã QR. Nếu chờ tới
 * lúc trang chạy mới cấp thì lượt đầu chưa có danh tính, và chính lượt đầu mới
 * là lúc cần nó.
 */

import { NextResponse, type NextRequest } from "next/server";
import { sessionSecret } from "./lib/auth/secret";
import { DEVICE_COOKIE } from "./lib/identity/device";
import {
  signDeviceTokenWeb,
  verifyDeviceTokenWeb,
} from "./lib/identity/device-token-web";

const ONE_YEAR = 365 * 24 * 60 * 60;

export async function middleware(request: NextRequest) {
  const secret = sessionSecret();
  const current = request.cookies.get(DEVICE_COOKIE)?.value;
  if (await verifyDeviceTokenWeb(current, secret)) return NextResponse.next();

  // Không ký lại UUID trần của bản cũ: những UUID ấy từng bị `/state` phát công
  // khai. Ký lại đồng nghĩa kẻ đã chép chúng cũng tự đổi được thành giấy thông
  // hành hợp lệ. Thay hẳn bằng một mã mới mới thật sự đóng đường mạo danh.
  const token = await signDeviceTokenWeb(crypto.randomUUID(), secret);

  // Cho route hiện tại nhìn thấy token mới ngay, không phải chờ lượt tải kế.
  // Nhờ vậy một tỷ số đang nằm trong hàng đợi IndexedDB không bị 403 và rơi mất
  // chỉ vì nó là yêu cầu đầu tiên sau khi nâng phiên bản.
  request.cookies.set(DEVICE_COOKIE, token);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("cookie", request.cookies.toString());
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.cookies.set(DEVICE_COOKIE, token, {
    httpOnly: true,
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
