/** Danh tính thiết bị đã được máy chủ ký, dùng ở các route Node. */

import type { NextRequest } from "next/server";
import { readPayload, signPayload } from "../auth/hmac";
import { sessionSecret } from "../auth/secret";
import { DEVICE_COOKIE } from "./device";

interface DeviceTokenPayload {
  v: 1;
  id: string;
}

/** Ký một mã máy mới. Xuất hàm này để kiểm thử tương thích với bản Web Crypto. */
export function signDeviceToken(deviceId: string, secret: string): string {
  if (!validDeviceId(deviceId)) throw new Error("Mã thiết bị không hợp lệ.");
  return signPayload({ v: 1, id: deviceId } satisfies DeviceTokenPayload, secret);
}

/**
 * Chỉ trả mã máy sau khi chữ ký và khuôn dữ liệu đều hợp lệ.
 *
 * Cookie UUID trần của các bản trước cố ý trả `null`: tự ký lại nó sẽ cho kẻ đã
 * chép mã từ `/state` xin một chữ ký hợp lệ và lỗ hổng vẫn còn nguyên.
 */
export function verifyDeviceToken(
  token: string | undefined,
  secret: string,
): string | null {
  const payload = readPayload<DeviceTokenPayload>(token, secret);
  if (!payload || payload.v !== 1 || !validDeviceId(payload.id)) return null;
  return payload.id;
}

/** Lối đọc duy nhất cho cookie thiết bị trong các API route. */
export function deviceIdFromRequest(request: NextRequest): string {
  return (
    verifyDeviceToken(
      request.cookies.get(DEVICE_COOKIE)?.value,
      sessionSecret(),
    ) ?? ""
  );
}

function validDeviceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}
