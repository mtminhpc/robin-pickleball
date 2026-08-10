import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, resolveContext } from "@/lib/api/context";
import { appendRoleAction, freshRoleState, roleAction } from "@/lib/api/event-roles";
import { withEventLock } from "@/lib/sheets/cache";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; roleId: string }> },
) {
  const { code: raw, roleId } = await params;
  const code = raw.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.capabilities.canManageRoles || ctx.role !== "owner") {
    return fail(403, "Chỉ Chủ vận hành hiện tại được thu hồi quyền Phó.");
  }
  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(ctx);
    if (!before.managers.some((manager) => manager.roleId === roleId)) {
      return fail(404, "Không tìm thấy vai trò Phó này.");
    }
    const after = await appendRoleAction(
      ctx,
      roleAction(ctx, "revoke-manager", { roleId }),
    );
    if (after.managers.some((manager) => manager.roleId === roleId)) {
      return fail(409, "Quyền chưa được thu hồi do có thay đổi đồng thời. Hãy thử lại.");
    }
    return NextResponse.json({ ok: true });
  });
}
