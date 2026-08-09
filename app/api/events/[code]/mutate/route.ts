/**
 * Mọi thay đổi trạng thái đi qua đây.
 *
 * Một lời gọi từ điện thoại tương ứng với một thao tác của người dùng, nhưng
 * thường sinh ra hai lệnh: cái họ vừa bấm, cộng thêm việc xếp lại lịch kéo theo.
 * Hai lệnh đó được ghi chung một lô nên vẫn chỉ tốn một lời gọi ghi lên Google
 * Sheet — hạn mức 60 request mỗi phút không cho phép làm khác.
 *
 * `commandId` do trình duyệt sinh và đi thẳng vào nhật ký. Đó là thứ khiến hàng
 * đợi ngoại tuyến gửi lại bao nhiêu lần cũng không nhân đôi kết quả.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  isAllowedForActor,
  SELF_SERVICE,
  type Command,
  type CommandEnvelope,
} from "@/lib/domain/commands";
import { nextScheduleCommand } from "@/lib/domain/autoplan";
import { apply } from "@/lib/domain/reduce";
import { canEditResult } from "@/lib/domain/rules";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import { redactEventState } from "@/lib/api/public-state";
import { getRepo, invalidateEvent, withEventLock } from "@/lib/sheets/cache";

interface MutateBody {
  commandId?: string;
  command?: Command;
}

/**
 * Ngân sách cho thuật toán xếp lịch trong một lời gọi.
 *
 * Vercel cắt hàm ở 10 giây với gói miễn phí. Người chơi đang đứng chờ ở sân, nên
 * 400ms là mức đổi hợp lý giữa chất lượng lịch và tốc độ phản hồi — bộ mô phỏng
 * cho thấy quá mức này thì chi phí gần như không giảm thêm.
 */
const PLANNING = { iterations: 20_000, timeBudgetMs: 400 } as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();

  const parsed = await readJson<MutateBody>(request);
  if (!parsed.ok) return parsed.response;
  const { commandId, command } = parsed.body;

  if (!commandId || !command?.type) {
    return fail(400, "Thiếu lệnh hoặc mã lệnh.");
  }

  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;

  const denied = checkPermission(command, ctx);
  if (denied) return fail(403, denied);

  const stamped = stampIdentity(command, ctx);

  // Xếp hàng theo mã sự kiện: hai người trong cùng một thực thể hàm không chen
  // nhau. Không chặn được hai thực thể khác nhau, nhưng chỗ đó đã có nhật ký
  // chỉ-ghi-thêm lo.
  const result = await withEventLock(code, async () => {
    const repo = getRepo();

    // Đọc lại ngoài bộ nhớ đệm. Đệm có thể cũ tới 5 giây, và ghi đè lên trạng
    // thái cũ 5 giây là đủ để nuốt mất một kết quả vừa được người khác nhập.
    const loaded = await repo.load(code);
    if (!loaded) return { ok: false as const, error: `Không tìm thấy sự kiện ${code}.` };

    const now = Date.now();
    const envelopes: CommandEnvelope[] = [
      { id: commandId, at: now, actor: ctx.actor, command: stamped },
    ];

    // Xếp lịch phải nhìn trạng thái SAU khi áp lệnh, không phải trước.
    // Lệnh "Bắt đầu" là ví dụ rõ nhất: nhìn trạng thái cũ thì sự kiện vẫn đang ở
    // nháp, và bộ xếp lịch sẽ từ chối làm gì cả — buổi đánh bắt đầu mà không có
    // một trận nào. `apply` là hàm thuần nên gọi thêm ở đây không có tác dụng phụ.
    const applied = apply(loaded.state, envelopes[0]!);
    const follow = applied.ok
      ? nextScheduleCommand(applied.value, command, PLANNING)
      : null;
    if (follow) {
      envelopes.push({
        id: `${commandId}-plan`,
        at: now + 1,
        actor: { kind: "system", label: "xếp lịch tự động" },
        command: follow,
      });
    }

    return repo.commitMany(code, envelopes, loaded);
  });

  if (!result.ok) return fail(409, result.error);

  invalidateEvent(code);
  return NextResponse.json({
    state: redactEventState(result.state, ctx.deviceId),
    seq: result.seq,
  });
}

/**
 * Đóng dấu danh tính của người gửi lên những lệnh cần nó.
 *
 * Danh tính lấy từ cookie đã ký, **ghi đè** thứ trình duyệt gửi lên. Cả hai lệnh
 * dưới đây đều công khai — ai quét được mã QR là gọi được — nên để trình duyệt
 * tự khai mình là ai thì bất kỳ ai cũng nhận được ô tên của người khác, hoặc
 * ghi kết quả dưới danh nghĩa tài khoản người khác.
 */
function stampIdentity(
  command: Command,
  ctx: Extract<Awaited<ReturnType<typeof resolveContext>>, { role: string }>,
): Command {
  const identity = {
    ...(ctx.deviceId ? { deviceId: ctx.deviceId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  };

  if (command.type === "ClaimPlayer") return { ...command, ...identity };
  if (command.type === "LinkAccount") return { ...command, ...identity };
  if (command.type === "RequestJoin") {
    return { ...command, player: { ...command.player, ...identity } };
  }
  return command;
}

/**
 * Kiểm quyền. Trả về câu giải thích nếu bị từ chối, `null` nếu được phép.
 *
 * `EditResult` không theo bảng phân quyền thông thường: trong hai phút đầu chính
 * người vừa nhập được sửa lại mà không cần mật khẩu chủ sự kiện. Đó là cách chống
 * bấm nhầm mà không phải nới quyền cho cả nhóm.
 *
 * `ctx.me` là người chơi ứng với cookie đã ký, nên nó **không giả mạo được** —
 * đó là điều khiến luật "chỉ sửa phần của chính mình" có giá trị thật chứ không
 * chỉ là ẩn nút đi trên giao diện.
 */
function checkPermission(
  command: Command,
  ctx: Extract<Awaited<ReturnType<typeof resolveContext>>, { role: string }>,
): string | null {
  if (
    (command.type === "ClaimPlayer" || command.type === "RequestJoin") &&
    !ctx.deviceId &&
    !ctx.userId
  ) {
    return "Trình duyệt đang chặn cookie nên chưa thể nhận ra bạn. Bật cookie rồi tải lại trang.";
  }
  if (command.type === "LinkAccount" && !ctx.userId) {
    return "Cần đăng nhập tài khoản trước khi gắn tên này.";
  }

  if (command.type === "EditResult" || command.type === "RevertResult") {
    const match = ctx.event.state.matches.find((m) => m.id === command.matchId);
    if (!match) return "Không tìm thấy trận.";
    const verdict = canEditResult(match, ctx.actor, Date.now(), ctx.event.state.config);
    return verdict.allowed ? null : verdict.reason;
  }

  const target = "playerId" in command ? command.playerId : null;
  if (isAllowedForActor(command.type, ctx.role, ctx.me?.id ?? null, target)) {
    return null;
  }

  if (SELF_SERVICE.includes(command.type)) {
    return ctx.me
      ? "Chỉ chủ sự kiện mới sửa được phần của người khác."
      : "Chưa nhận ra bạn là ai trong buổi này. Vào trang Tham gia để nhận tên của bạn.";
  }
  if (ctx.role === "viewer") {
    return "Cần mật khẩu để nhập điểm. Hỏi người tổ chức buổi đánh.";
  }
  return "Việc này chỉ chủ sự kiện làm được.";
}
