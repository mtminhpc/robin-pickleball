import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import { appendRoleAction, freshRoleState, roleAction } from "@/lib/api/event-roles";
import { normalizeEmail } from "@/lib/domain/account";
import { subjectsReferToSameIdentity, type EventManagerRole, type RoleSubject } from "@/lib/domain/event-roles";
import { checkRateLimit } from "@/lib/auth/ratelimit";
import {
  getAccountRepo,
  getEventStaffRepo,
  invalidateEventStaff,
  withEventLock,
} from "@/lib/sheets/cache";

const MAX_STAFF = 5;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const owner = await requireOwner(request, code);
  if (owner instanceof NextResponse) return owner;

  let members = await getEventStaffRepo().list(code);
  for (const member of members) {
    if (member.status !== "pending") continue;
    const account = await getAccountRepo().byEmail(member.email);
    if (!account) continue;
    await getEventStaffRepo().activate(
      member,
      { userId: account.userId, displayName: account.displayName },
      Date.now(),
    );
  }
  invalidateEventStaff(code);
  const roles = await freshRoleState(owner);
  return NextResponse.json({
    max: MAX_STAFF,
    members: roles.managers.map(publicStaff),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const owner = await requireOwner(request, code);
  if (owner instanceof NextResponse) return owner;

  const limit = checkRateLimit(`staff:${owner.actor.ref ?? owner.deviceId}:${code}`);
  if (!limit.allowed) {
    return fail(429, `Thao tác quá nhanh. Thử lại sau ${limit.retryAfterSeconds} giây.`);
  }
  const parsed = await readJson<{ email?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const email = normalizeEmail(typeof parsed.body.email === "string" ? parsed.body.email : "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(400, "Email phó sự kiện không hợp lệ.");
  if (owner.accountEmail && email === normalizeEmail(owner.accountEmail)) {
    return fail(400, "Chủ sự kiện không cần được thêm làm Phó sự kiện.");
  }

  const account = await getAccountRepo().byEmail(email);
  const subject: RoleSubject = account
    ? { kind: "account", userId: account.userId, email, label: account.displayName || email }
    : { kind: "pending-email", email, label: email };

  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(owner);
    if (before.managers.some((member) =>
      subjectsReferToSameIdentity(owner.event.state, member.subject, subject)
    )) {
      return fail(409, "Email này đã có trong đội điều hành.");
    }
    if (before.managers.length >= MAX_STAFF) {
      return fail(409, `Mỗi sự kiện chỉ có tối đa ${MAX_STAFF} Phó sự kiện, kể cả lời mời đang chờ.`);
    }
    const roleId = randomUUID();
    const after = await appendRoleAction(
      owner,
      roleAction(owner, "grant-manager", { roleId, subject }),
    );
    const member = after.managers.find((candidate) => candidate.roleId === roleId);
    if (!member) {
      return fail(409, "Một lời mời đồng thời vừa dùng vị trí Phó sự kiện cuối cùng hoặc email này đã được mời.");
    }
    return NextResponse.json({ member: publicStaff(member) }, { status: 201 });
  });
}

async function requireOwner(request: NextRequest, code: string) {
  const context = await resolveContext(request, code);
  if (isResponse(context)) return context;
  if (!context.capabilities.canManageRoles || context.role !== "owner") {
    return fail(403, "Chỉ Chủ sự kiện được quản lý đội điều hành.");
  }
  return context;
}

function publicStaff(member: EventManagerRole) {
  return {
    staffId: member.roleId,
    email: member.subject.kind === "player" ? "" : member.subject.email ?? "",
    displayName: member.subject.label,
    status: member.status,
    createdAt: member.createdAt,
  };
}
