import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { fail, isResponse, resolveContext } from "@/lib/api/context";
import { freshRoleState } from "@/lib/api/event-roles";
import { roleInvitationStatus } from "@/lib/auth/role-invitations";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; inviteId: string }> },
) {
  const { code: raw, inviteId } = await params;
  const code = raw.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.capabilities.canManageRoles || ctx.role !== "owner") {
    return fail(403, "Chỉ Chủ được xem QR lời mời quản lý.");
  }
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const roles = await freshRoleState(ctx, { expire: false });
  const manager = roles.managers.find((item) => item.inviteId === inviteId);
  const transfer = roles.pendingTransfer?.inviteId === inviteId ? roles.pendingTransfer : null;
  const expectedHash = manager?.tokenHash ?? transfer?.tokenHash ?? "";
  const invitationStatus = roleInvitationStatus(
    token,
    expectedHash,
    manager?.expiresAt ?? transfer?.expiresAt,
  );
  if (invitationStatus === "invalid") return fail(403, "Mã lời mời không đúng.");
  if (invitationStatus === "expired" || ctx.event.state.status === "finished") {
    return fail(410, "Lời mời đã hết hiệu lực.");
  }
  const url = manager
    ? `${request.nextUrl.origin}/e/${code}?roleInvite=${encodeURIComponent(inviteId)}&roleToken=${encodeURIComponent(token)}`
    : `${request.nextUrl.origin}/e/${code}?ownerInvite=${encodeURIComponent(inviteId)}&ownerToken=${encodeURIComponent(token)}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "H" });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "private, no-store",
    },
  });
}
