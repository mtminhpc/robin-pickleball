/**
 * Đặt lại mật khẩu của một buổi đánh.
 *
 * **Chỉ chủ-theo-tài-khoản gọi được, không phải bất kỳ ai đang mang vai trò
 * `admin`.** Người đang là admin chỉ vì họ biết mật khẩu cũ — có thể là người
 * được nhờ nhập điểm hộ tối qua, hoặc bất kỳ ai mật khẩu đó lọt tới. Cho họ đổi
 * mật khẩu là cho họ khoá chính chủ ra ngoài. `ownerUserId` thì không lan như
 * vậy: nó gắn với tài khoản Google đã tạo ra buổi đánh.
 *
 * Đây cũng là câu trả lời cho "quên mật khẩu thì sao". Trước đây là không có câu
 * trả lời nào: buổi đánh thành chỉ-đọc vĩnh viễn.
 */

import { NextResponse, type NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth/passwords";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import { getRepo, invalidateEvent } from "@/lib/sheets/cache";

interface Body {
  adminPassword?: string;
  /** Chuỗi rỗng là bỏ mật khẩu người chơi, khác hẳn với không gửi trường này. */
  playerPassword?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();

  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;

  if (!ctx.ownerByAccount) {
    return fail(
      403,
      "Chỉ tài khoản đã tạo ra buổi đánh này mới đổi được mật khẩu. Đăng nhập bằng tài khoản đó rồi thử lại.",
    );
  }

  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;

  const patch: { adminPassHash?: string; playerPassHash?: string } = {};

  if (parsed.body.adminPassword !== undefined) {
    const next = parsed.body.adminPassword;
    if (next.length < 4) {
      return fail(400, "Mật khẩu chủ sự kiện phải ít nhất 4 ký tự.");
    }
    patch.adminPassHash = await hashPassword(next);
  }

  if (parsed.body.playerPassword !== undefined) {
    // Để trống là cố ý bỏ mật khẩu người chơi — ai có đường dẫn cũng nhập điểm
    // được, đúng như lúc tạo buổi. Nên chuỗi rỗng lưu thành hàm băm rỗng.
    patch.playerPassHash = parsed.body.playerPassword
      ? await hashPassword(parsed.body.playerPassword)
      : "";
  }

  if (Object.keys(patch).length === 0) {
    return fail(400, "Chưa có mật khẩu mới nào được gửi lên.");
  }

  const ok = await getRepo().updatePasswords(code, patch);
  if (!ok) return fail(404, `Không tìm thấy sự kiện có mã ${code}.`);

  invalidateEvent(code);

  // Cookie phiên cũ vẫn còn hạn và vẫn cho quyền như trước. Đó là chủ ý: người
  // vừa đổi mật khẩu không có lý do gì bị đá ra khỏi buổi đánh đang diễn ra, và
  // quyền của chính họ vốn đã đến từ tài khoản chứ không từ mật khẩu.
  return NextResponse.json({ changed: Object.keys(patch) });
}
