import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, resolveContext } from "@/lib/api/context";
import { appendRoleAction, freshRoleState, roleAction } from "@/lib/api/event-roles";
import { withEventLock } from "@/lib/sheets/cache";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; staffId: string }> },
) {
  const { code: raw, staffId } = await params;
  const code = raw.toUpperCase();
  const context = await resolveContext(request, code);
  if (isResponse(context)) return context;
  if (!context.capabilities.canManageRoles || context.role !== "owner") {
    return fail(403, "Chỉ Chủ sự kiện được thu hồi quyền Phó sự kiện.");
  }

  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(context);
    if (!before.managers.some((manager) => manager.roleId === staffId)) {
      return fail(404, "Không tìm thấy Phó sự kiện này.");
    }
    const after = await appendRoleAction(
      context,
      roleAction(context, "revoke-manager", { roleId: staffId }),
    );
    return after.managers.some((manager) => manager.roleId === staffId)
      ? fail(409, "Quyền chưa được thu hồi do có thay đổi đồng thời. Hãy thử lại.")
      : NextResponse.json({ ok: true });
  });
}
