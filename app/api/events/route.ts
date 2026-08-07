/**
 * Tạo sự kiện mới.
 *
 * Người tạo nhận luôn quyền chủ sự kiện qua cookie, không phải nhập lại mật khẩu
 * admin vừa đặt — họ vừa gõ nó xong, bắt gõ lại chỉ tổ khó chịu.
 */

import { NextResponse, type NextRequest } from "next/server";
import { generateEventCode, hashPassword } from "@/lib/auth/passwords";
import {
  SESSION_TTL_SECONDS,
  cookieName,
  newSession,
  sessionSecret,
  signSession,
} from "@/lib/auth/session";
import type { CommandEnvelope } from "@/lib/domain/commands";
import { emptyState } from "@/lib/domain/reduce";
import { DEFAULT_CONFIG, type EventConfig } from "@/lib/domain/types";
import { getRepo, invalidateEvent } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";

interface CreateBody {
  name?: string;
  courts?: number;
  pointsTo?: number;
  winBy2?: boolean;
  playerPassword?: string;
  adminPassword?: string;
}

export async function POST(request: NextRequest) {
  const parsed = await readJson<CreateBody>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const name = (body.name ?? "").trim();
  if (name.length < 2) return fail(400, "Đặt tên cho buổi đánh (ít nhất 2 ký tự).");

  const courts = Math.round(body.courts ?? DEFAULT_CONFIG.courts);
  if (courts < 1 || courts > 8) return fail(400, "Số sân phải từ 1 đến 8.");

  const pointsTo = Math.round(body.pointsTo ?? DEFAULT_CONFIG.scoring.pointsTo);
  if (pointsTo < 5 || pointsTo > 50) return fail(400, "Mốc điểm phải từ 5 đến 50.");

  const adminPassword = body.adminPassword ?? "";
  if (adminPassword.length < 4) {
    return fail(400, "Mật khẩu chủ sự kiện phải ít nhất 4 ký tự.");
  }
  // Mật khẩu người chơi để trống nghĩa là ai có đường dẫn cũng nhập điểm được.
  // Hợp lý với nhóm quen nhau, nên cho phép chứ không ép đặt.
  const playerPassword = body.playerPassword ?? "";

  const config: EventConfig = {
    ...DEFAULT_CONFIG,
    name,
    courts,
    scoring: { pointsTo, winBy2: body.winBy2 ?? DEFAULT_CONFIG.scoring.winBy2 },
  };

  const repo = getRepo();
  const code = await pickUnusedCode(repo);
  const now = Date.now();

  const record = await repo.create(
    {
      code,
      clubId: null,
      name,
      status: "draft",
      ownerUserId: "",
      playerPassHash: playerPassword ? await hashPassword(playerPassword) : "",
      adminPassHash: await hashPassword(adminPassword),
    },
    now,
  );

  const envelope: CommandEnvelope = {
    id: `create-${code}`,
    at: now,
    actor: { kind: "admin", label: "chủ sự kiện" },
    command: { type: "CreateEvent", code, clubId: null, config },
  };

  // Dùng thẳng trạng thái rỗng thay vì đọc lại từ kho: sự kiện vừa được tạo nên
  // chắc chắn nhật ký còn trống, và một lần đọc thừa là một phần hạn mức bị phí.
  const committed = await repo.append(code, envelope, {
    record,
    state: emptyState(code),
    repaired: false,
    skipped: [],
  });
  if (!committed.ok) return fail(500, committed.error);

  invalidateEvent(code);

  const response = NextResponse.json({ code, name });
  response.cookies.set(
    cookieName(code),
    signSession(newSession(code, "admin", now), sessionSecret()),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    },
  );
  return response;
}

/**
 * Sinh mã chưa ai dùng.
 *
 * Không gian mã đủ lớn để va chạm gần như không xảy ra, nhưng "gần như" thì vẫn
 * là có — và một mã trùng sẽ khiến hai buổi đánh ghi đè lên nhau, kiểu hỏng tệ
 * nhất có thể. Ba lần thử là thừa đủ.
 */
async function pickUnusedCode(repo: ReturnType<typeof getRepo>): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateEventCode();
    if (!(await repo.load(code))) return code;
  }
  throw new Error("Không sinh được mã sự kiện mới. Thử lại sau.");
}
