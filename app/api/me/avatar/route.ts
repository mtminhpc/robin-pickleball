/**
 * Đổi hoặc xoá ảnh đại diện của chính mình.
 *
 * `PUT` nhận một data URI đã được trình duyệt thu nhỏ sẵn (xem
 * [lib/avatars/resize.ts](lib/avatars/resize.ts)); `DELETE` xoá nó đi để quay về
 * ảnh Google, hoặc về biểu tượng suy từ tên nếu không có ảnh Google.
 *
 * Kiểm kích thước và định dạng **trước khi** chạm tới bảng tính. Tin vào bước
 * kiểm ở trình duyệt là không đủ: đường này gọi thẳng bằng `curl` được, và một
 * chuỗi vài megabyte lọt xuống Sheets sẽ làm hỏng cả dòng tài khoản — mỗi ô chỉ
 * chứa được 50.000 ký tự.
 */

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { validateEventImageDataUri } from "@/lib/assets/event-image";
import { validImageEditMetadata, type ImageEditMetadata } from "@/lib/assets/edit-metadata";
import { getAccountAssetRepo, getAccountRepo, invalidateAccount } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";

interface Body {
  photo?: unknown;
  editMetadata?: ImageEditMetadata;
}

export async function PUT(request: NextRequest) {
  const me = await currentUser(request);
  if (!me) return fail(401, "Cần đăng nhập mới đổi được ảnh đại diện.");

  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;

  const checked = validateEventImageDataUri(parsed.body.photo);
  if (!checked || !validImageEditMetadata(parsed.body.editMetadata)) {
    return fail(400, "Ảnh đại diện hoặc thông số cắt ảnh không hợp lệ.");
  }

  // Ghi lại nguyên chuỗi đã kiểm chứ không dựng lại từ `mime` và `base64`: dựng
  // lại là thêm một chỗ để hai bên lệch nhau, mà chuỗi đã qua được biểu thức
  // chính quy thì đã đúng khuôn rồi.
  const assetId = randomUUID();
  const now = Date.now();
  await getAccountAssetRepo().put({
    userId: me.account.userId,
    assetId,
    kind: "avatar",
    ...checked,
    metadata: parsed.body.editMetadata!,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const previous = me.account.prefs.photoAssetId;
  const updated = await getAccountRepo().updatePrefs(me.account.userId, {
    photoAssetId: assetId,
    photo: undefined,
  });
  if (!updated) return fail(404, "Không tìm thấy tài khoản của bạn.");
  if (previous) await getAccountAssetRepo().deactivate(me.account.userId, previous, now);

  invalidateAccount(me.account.userId);
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: NextRequest) {
  const me = await currentUser(request);
  if (!me) return fail(401, "Cần đăng nhập mới đổi được ảnh đại diện.");

  // `undefined` là xoá hẳn khoá, không phải ghi chuỗi rỗng vào. `prefs.picture`
  // giữ nguyên, nên xoá ảnh tự tải lên là quay về đúng ảnh Google.
  const updated = await getAccountRepo().updatePrefs(me.account.userId, {
    photo: undefined,
    photoAssetId: undefined,
  });
  if (!updated) return fail(404, "Không tìm thấy tài khoản của bạn.");
  if (me.account.prefs.photoAssetId) {
    await getAccountAssetRepo().deactivate(me.account.userId, me.account.prefs.photoAssetId, Date.now());
  }

  invalidateAccount(me.account.userId);
  return NextResponse.json({ removed: true });
}
