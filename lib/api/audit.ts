import type { EventRoleAction } from "../domain/event-roles";

/** Dạng công khai cố ý không chứa actorRef, subject ref, tokenHash hay raw token. */
export function publicRoleAudit(action: EventRoleAction) {
  return {
    id: `role:${action.id}`,
    actorLabel: action.actorLabel,
    at: action.at,
    type: action.type,
    effectiveRound: null,
    summary: roleSummary(action),
  };
}

function roleSummary(action: EventRoleAction): string {
  const label = action.subject?.label ? ` · ${action.subject.label}` : "";
  switch (action.type) {
    case "grant-manager": return `Cấp/lời mời Phó${label}`;
    case "accept-manager": return "Chấp nhận quyền Phó";
    case "expire-manager": return "Lời mời Phó hết hạn";
    case "revoke-manager": return "Thu hồi quyền Phó";
    case "start-owner-transfer": return `Khởi tạo chuyển Chủ${label}`;
    case "accept-owner-transfer": return "Chấp nhận chuyển Chủ vận hành";
    case "expire-owner-transfer": return "Yêu cầu chuyển Chủ hết hạn";
    case "cancel-owner-transfer": return "Huỷ chuyển Chủ";
    case "confirm-account-transfer": return "Xác nhận hoàn tất chuyển quyền tài khoản";
    case "complete-account-transfer": return "Hoàn tất chuyển quyền tài khoản";
  }
}
