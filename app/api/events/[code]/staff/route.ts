import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/api/user";
import { fail, readJson } from "@/lib/api/context";
import { normalizeEmail } from "@/lib/domain/account";
import { checkRateLimit } from "@/lib/auth/ratelimit";
import type { EventStaffMember } from "@/lib/sheets/event-staff";
import {
  getAccountRepo,
  getEventStaffRepo,
  invalidateEventStaff,
  readEvent,
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
  members = await getEventStaffRepo().list(code);
  return NextResponse.json({
    max: MAX_STAFF,
    members: members.map(publicStaff),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const owner = await requireOwner(request, code);
  if (owner instanceof NextResponse) return owner;

  const limit = checkRateLimit(`staff:${owner.account.userId}:${code}`);
  if (!limit.allowed) {
    return fail(429, `Thao tác quá nhanh. Thử lại sau ${limit.retryAfterSeconds} giây.`);
  }
  const parsed = await readJson<{ email?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const email = normalizeEmail(typeof parsed.body.email === "string" ? parsed.body.email : "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(400, "Email phó sự kiện không hợp lệ.");
  if (email === normalizeEmail(owner.account.email)) {
    return fail(400, "Chủ sự kiện không cần được thêm làm Phó sự kiện.");
  }

  return withEventLock(`staff:${code}`, async () => {
    const repo = getEventStaffRepo();
    const members = await repo.list(code);
    if (members.some((member) => member.email === email)) {
      return fail(409, "Email này đã có trong đội điều hành.");
    }
    if (members.length >= MAX_STAFF) {
      return fail(409, `Mỗi sự kiện chỉ có tối đa ${MAX_STAFF} Phó sự kiện, kể cả lời mời đang chờ.`);
    }
    const account = await getAccountRepo().byEmail(email);
    const member = await repo.invite({
      eventCode: code,
      email,
      userId: account?.userId,
      displayName: account?.displayName,
      grantedBy: owner.account.userId,
      at: Date.now(),
    });
    // Append của Sheets có thứ tự toàn cục giữa các Vercel instance. Đọc lại sau
    // append để chỉ năm email đầu tiên thắng, kể cả hai request cùng thấy còn một chỗ.
    const after = await repo.list(code);
    const allowed: EventStaffMember[] = [];
    const seenEmails = new Set<string>();
    for (const candidate of after) {
      if (seenEmails.has(candidate.email)) continue;
      seenEmails.add(candidate.email);
      if (allowed.length < MAX_STAFF) allowed.push(candidate);
    }
    if (!allowed.some((candidate) => candidate.staffId === member.staffId)) {
      await repo.revoke(code, member.staffId, Date.now());
      invalidateEventStaff(code);
      return fail(409, "Một lời mời đồng thời vừa dùng vị trí Phó sự kiện cuối cùng hoặc email này đã được mời.");
    }
    invalidateEventStaff(code);
    return NextResponse.json({ member: publicStaff(member) }, { status: 201 });
  });
}

async function requireOwner(request: NextRequest, code: string) {
  const [user, event] = await Promise.all([currentUser(request), readEvent(code)]);
  if (!user) return fail(401, "Hãy đăng nhập Google bằng tài khoản Chủ sự kiện.");
  if (!event) return fail(404, `Không tìm thấy sự kiện có mã ${code}.`);
  if (!event.record.ownerUserId || event.record.ownerUserId !== user.account.userId) {
    return fail(403, "Chỉ Chủ sự kiện được quản lý đội điều hành.");
  }
  return user;
}

function publicStaff(member: EventStaffMember) {
  return {
    staffId: member.staffId,
    email: member.email,
    displayName: member.displayName,
    status: member.status,
    createdAt: member.createdAt,
  };
}
