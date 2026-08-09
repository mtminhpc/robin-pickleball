import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/api/user";
import { fail, readJson } from "@/lib/api/context";
import { isAppAdminEmail, validEventLimit } from "@/lib/domain/app-admin";
import { normalizeEmail } from "@/lib/domain/account";
import { getAppEventLimitRepo } from "@/lib/sheets/cache";

async function appAdmin(request: NextRequest) {
  const user = await currentUser(request);
  return user && isAppAdminEmail(user.account.email) ? user : null;
}

export async function GET(request: NextRequest) {
  if (!(await appAdmin(request))) return fail(403, "Chỉ quản trị viên ứng dụng được xem hạn mức.");
  return NextResponse.json({ limits: await getAppEventLimitRepo().list() });
}

export async function PUT(request: NextRequest) {
  const admin = await appAdmin(request);
  if (!admin) return fail(403, "Chỉ quản trị viên ứng dụng được đặt hạn mức.");
  const parsed = await readJson<{ email?: string; limit?: number | null }>(request);
  if (!parsed.ok) return parsed.response;
  const email = normalizeEmail(parsed.body.email ?? "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(400, "Email không hợp lệ.");
  if (!validEventLimit(parsed.body.limit)) return fail(400, "Hạn mức phải từ 3 đến 100, hoặc Không giới hạn.");
  await getAppEventLimitRepo().upsert(email, parsed.body.limit, admin.account.email, Date.now());
  return NextResponse.json({ ok: true, email, limit: parsed.body.limit });
}

export async function DELETE(request: NextRequest) {
  const admin = await appAdmin(request);
  if (!admin) return fail(403, "Chỉ quản trị viên ứng dụng được xoá hạn mức.");
  const email = normalizeEmail(request.nextUrl.searchParams.get("email") ?? "");
  if (!email) return fail(400, "Thiếu email.");
  const removed = await getAppEventLimitRepo().revoke(email, admin.account.email, Date.now());
  return NextResponse.json({ ok: true, removed });
}
