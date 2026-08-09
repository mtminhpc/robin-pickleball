/**
 * Đặt hoặc xoá ảnh thật cho một ô tên trong buổi đánh.
 *
 * Khác `/api/me/avatar` ở đúng một điều, và đó là toàn bộ lý do nó tồn tại:
 * **không bắt đăng nhập Google**. Người quét mã QR ở sân là đối tượng đông nhất
 * của ứng dụng này, và bắt họ có tài khoản Google chỉ để có mặt trong hàng trận
 * là dựng một cửa ải mà phần lớn sẽ không qua.
 *
 * Ảnh vẫn không nằm trong trạng thái sự kiện. Trạng thái đã phải cắt làm bốn ô
 * vì mỗi ô Sheets chỉ chứa 50.000 ký tự; mười sáu tấm ảnh là hơn nửa ngân sách
 * đó, chưa kể lịch và nhật ký lệnh. Nên người chưa có tài khoản được cấp một
 * **tài khoản vãng lai** (`GUEST_PREFIX`, email rỗng), và ô tên chỉ mang theo
 * `userId` trỏ tới đó — vài chục ký tự thay vì vài nghìn.
 *
 * Nhờ cách đó `/api/avatar/[userId]` và `<Avatar userId=…>` không phải sửa một
 * dòng nào: chúng vốn đã không quan tâm tài khoản kia từ đâu ra.
 */

import { NextResponse, type NextRequest } from "next/server";
import { checkPhotoDataUri } from "@/lib/avatars/photo";
import type { CommandEnvelope } from "@/lib/domain/commands";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import {
  getAccountRepo,
  getRepo,
  invalidateAccount,
  invalidateEvent,
  withEventLock,
} from "@/lib/sheets/cache";

interface Body {
  photo?: unknown;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; playerId: string }> },
) {
  const found = await resolve(request, params);
  if (isResponse(found)) return found;
  const { code, player } = found;

  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;

  // Kiểm khuôn và kích thước TRƯỚC khi chạm bảng tính, y như `/api/me/avatar`:
  // đường này gọi thẳng bằng `curl` được, và một chuỗi vài megabyte lọt xuống
  // Sheets sẽ làm hỏng cả dòng tài khoản.
  const checked = checkPhotoDataUri(parsed.body.photo);
  if (!checked.ok) return fail(400, checked.error);
  const photo = parsed.body.photo as string;

  if (player.userId) {
    const updated = await getAccountRepo().updatePrefs(player.userId, { photo });
    if (!updated) return fail(404, "Không tìm thấy tài khoản gắn với tên này.");
    invalidateAccount(player.userId);
    return NextResponse.json({ saved: true, userId: player.userId });
  }

  // Chưa có chỗ nào để cất ảnh thì lập một tài khoản vãng lai, rồi trỏ ô tên vào
  // đó. Thứ tự này quan trọng: lập tài khoản trước, gắn sau. Ngược lại thì một
  // lần ghi hỏng giữa chừng sẽ để lại ô tên trỏ vào một dòng không tồn tại.
  const guest = await getAccountRepo().createGuest({
    displayName: player.name,
    avatarId: player.avatarId,
    at: Date.now(),
  });
  await getAccountRepo().updatePrefs(guest.userId, { photo });
  invalidateAccount(guest.userId);

  const linked = await link(code, player.id, guest.userId);
  if (!linked.ok) return fail(409, linked.error);

  return NextResponse.json({ saved: true, userId: guest.userId });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; playerId: string }> },
) {
  const found = await resolve(request, params);
  if (isResponse(found)) return found;
  const { player } = found;

  // Chưa từng có ảnh thì coi như đã xoá xong. Báo lỗi ở đây chỉ làm nút "xoá
  // ảnh" đỏ lên vì một việc vốn đã đúng như người dùng muốn.
  if (!player.userId) return NextResponse.json({ removed: true });

  // `undefined` là xoá hẳn khoá chứ không ghi chuỗi rỗng. `picture` giữ nguyên,
  // nên người có tài khoản Google xoá ảnh tự tải lên là quay về ảnh Google.
  const updated = await getAccountRepo().updatePrefs(player.userId, {
    photo: undefined,
  });
  if (!updated) return fail(404, "Không tìm thấy tài khoản gắn với tên này.");

  invalidateAccount(player.userId);
  return NextResponse.json({ removed: true });
}

// ---------------------------------------------------------------------------

/**
 * Tìm người chơi và xét quyền.
 *
 * Được đổi ảnh của một ô tên khi là **chủ sự kiện**, hoặc khi ô tên đó **chính
 * là mình**. `ctx.me` do máy chủ tính từ cookie đã ký (tài khoản trước, máy sau
 * — xem `findMyPlayer`), nên không khai man được.
 */
async function resolve(
  request: NextRequest,
  params: Promise<{ code: string; playerId: string }>,
) {
  const { code: raw, playerId } = await params;
  const code = raw.toUpperCase();

  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;

  const player = ctx.event.state.players.find((p) => p.id === playerId);
  if (!player) return fail(404, "Không tìm thấy người chơi trong buổi này.");

  if (ctx.role !== "admin" && ctx.me?.id !== player.id) {
    return fail(
      403,
      ctx.me
        ? "Chỉ đổi được ảnh của chính bạn. Chủ sự kiện đổi được cho mọi người."
        : "Chưa nhận ra bạn là ai trong buổi này. Vào trang Tham gia để nhận tên của bạn.",
    );
  }

  return { code, player, ctx };
}

/**
 * Ghi lệnh gắn tài khoản vãng lai vào ô tên.
 *
 * Đi qua đúng đường mà `/mutate` đi — khoá theo mã buổi, đọc lại ngoài bộ đệm,
 * ghi vào nhật ký — chứ không sửa trạng thái tại chỗ. Nhật ký chỉ-ghi-thêm là
 * thứ giữ cho hai điện thoại cùng bấm một lúc không đè lên nhau, và một đường
 * ghi tắt sẽ phá đúng bảo đảm đó.
 *
 * **Cố ý không gửi kèm `deviceId`.** Việc ở đây là gắn chỗ cất ảnh, không phải
 * nhận ô tên. Gửi kèm thì chủ sự kiện đặt ảnh hộ một người đã nhận tên bằng điện
 * thoại của họ sẽ bị chính lá chắn chống chiếm tên chặn lại — máy chủ đang cầm
 * là máy của chủ sân, không phải của người kia.
 */
async function link(
  code: string,
  playerId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await withEventLock(code, async () => {
    const repo = getRepo();
    const loaded = await repo.load(code);
    if (!loaded) return { ok: false as const, error: `Không tìm thấy sự kiện ${code}.` };

    const envelope: CommandEnvelope = {
      id: `photo-${playerId}-${userId}`,
      at: Date.now(),
      actor: { kind: "system", label: "gắn ảnh" },
      command: { type: "LinkAccount", playerId, userId },
    };
    return repo.commitMany(code, [envelope], loaded);
  });

  if (!result.ok) return { ok: false, error: result.error };
  invalidateEvent(code);
  return { ok: true };
}
