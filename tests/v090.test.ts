import { describe, expect, it } from "vitest";
import {
  foldEventRoles,
  roleForIdentity,
  subjectMatches,
  type EventRoleAction,
  type RoleSubject,
} from "../lib/domain/event-roles";
import { capabilitiesForResolvedRole, roleFor } from "../lib/api/context";
import { publicRoleState } from "../lib/api/event-roles";
import { publicRoleAudit } from "../lib/api/audit";
import { hashRoleInvitation, newRoleInvitationToken, roleInvitationMatches, roleInvitationStatus } from "../lib/auth/role-invitations";
import { isGuestUser } from "../lib/domain/account";
import { googleLinkedPlayerIds } from "../lib/api/public-state";
import { emptyState } from "../lib/domain/reduce";
import { FakeSheetsClient } from "../lib/sheets/client";
import { EventRoleRepo } from "../lib/sheets/event-roles";
import { EventRepo } from "../lib/sheets/repo";
import type { Player } from "../lib/domain/types";

const CODE = "TESTV9";
const OWNER: RoleSubject = { kind: "account", userId: "owner-old", email: "old@example.com", label: "Chủ cũ" };

function action(
  type: EventRoleAction["type"],
  index: number,
  extra: Partial<EventRoleAction> = {},
): EventRoleAction {
  return {
    id: `a-${index}`,
    eventCode: CODE,
    type,
    actorLabel: "Chủ TEST",
    actorRef: "private-owner-ref",
    at: index,
    ...extra,
  };
}

function player(id: string, deviceId?: string, userId?: string): Player {
  return {
    id,
    name: id,
    avatarId: "a01",
    status: "active",
    deviceId,
    userId,
    presence: [{ from: 1, to: null }],
    availability: [],
    catchUpCredit: 0,
    addedAt: 1,
  };
}

describe("v0.9 — fold ledger vai trò", () => {
  it("seed event_staff cũ và ledger mới cùng hoạt động mà không migration ghi", () => {
    const state = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "owner-old",
      legacyStaff: [{
        staffId: "legacy-1", eventCode: CODE, email: "pho@example.com",
        userId: "u-pho", displayName: "Phó cũ", status: "active",
        grantedBy: "owner-old", createdAt: 1, revokedAt: null,
      }],
      actions: [action("grant-manager", 2, {
        roleId: "new-1",
        subject: { kind: "player", playerId: "p2", label: "Phó mới" },
      })],
    });
    expect(state.owner).toMatchObject({ kind: "account", userId: "owner-old" });
    expect(state.managers.map((role) => role.roleId)).toEqual(["staff:legacy-1", "new-1"]);
    expect(state.managers[0]?.source).toBe("event_staff");
  });

  it("ledger mới có thể thu hồi seed event_staff cũ mà không sửa dòng cũ", () => {
    const legacy = {
      staffId: "legacy-1", eventCode: CODE, email: "pho@example.com",
      userId: "u-pho", displayName: "Phó cũ", status: "active" as const,
      grantedBy: "owner-old", createdAt: 1, revokedAt: null,
    };
    const state = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "owner-old",
      legacyStaff: [legacy],
      actions: [action("revoke-manager", 2, { roleId: "staff:legacy-1" })],
    });
    expect(state.managers).toHaveLength(0);
    expect(legacy.status).toBe("active");
  });

  it("lời mời ô chưa nhận chỉ active sau accept đúng invite", () => {
    const subject: RoleSubject = { kind: "player", playerId: "p1", label: "An" };
    const pending = action("grant-manager", 1, {
      roleId: "r1", inviteId: "i1", tokenHash: "hash", expiresAt: 99, subject,
    });
    expect(foldEventRoles({ eventCode: CODE, ownerUserId: "owner-old", actions: [pending] }).managers[0]?.status).toBe("pending");
    const wrong = action("accept-manager", 2, { roleId: "r1", inviteId: "wrong" });
    const accepted = action("accept-manager", 3, { roleId: "r1", inviteId: "i1" });
    const state = foldEventRoles({ eventCode: CODE, ownerUserId: "owner-old", actions: [pending, wrong, accepted] });
    expect(state.managers[0]?.status).toBe("active");
    expect(state.managers[0]?.tokenHash).toBeNull();
  });

  it("hành động hết hạn giải phóng lời mời Phó và chuyển Chủ theo replay", () => {
    const manager = action("grant-manager", 1, {
      roleId: "r-expired", inviteId: "i-expired", tokenHash: "hash", expiresAt: 10,
      subject: { kind: "player", playerId: "p1", label: "An" },
    });
    const transfer = action("start-owner-transfer", 2, {
      transferId: "t-expired", expiresAt: 10,
      subject: { kind: "player", playerId: "p2", label: "Bình" },
    });
    const state = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "owner-old",
      actions: [
        manager,
        transfer,
        action("expire-manager", 3, { roleId: "r-expired", inviteId: "i-expired" }),
        action("expire-owner-transfer", 4, { transferId: "t-expired" }),
      ],
    });
    expect(state.managers).toHaveLength(0);
    expect(state.pendingTransfer).toBeNull();
    expect(state.actions.map((item) => item.type)).toContain("expire-owner-transfer");
  });

  it("sáu request đồng thời chỉ năm Phó đầu tiên thắng theo thứ tự dòng", () => {
    const actions = Array.from({ length: 6 }, (_, index) => action("grant-manager", index + 1, {
      roleId: `r${index + 1}`,
      subject: { kind: "player", playerId: `p${index + 1}`, label: `P${index + 1}` },
    }));
    const state = foldEventRoles({ eventCode: CODE, ownerUserId: "owner-old", actions });
    expect(state.managers.map((role) => role.roleId)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("một account và ô đã liên kết account đó chỉ chiếm một vị trí Phó", () => {
    const eventState = emptyState(CODE);
    eventState.players = [player("p1", "device-1", "u-same")];
    const state = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "owner-old",
      state: eventState,
      actions: [
        action("grant-manager", 1, {
          roleId: "account-role",
          subject: { kind: "account", userId: "u-same", label: "An Google" },
        }),
        action("grant-manager", 2, {
          roleId: "player-role",
          subject: { kind: "player", playerId: "p1", label: "An trên sân" },
        }),
      ],
    });
    expect(state.managers.map((role) => role.roleId)).toEqual(["account-role"]);
  });

  it("hai target tranh chuyển Chủ chỉ pending đầu tiên và accept hợp lệ đầu tiên thắng", () => {
    const actions = [
      action("start-owner-transfer", 1, {
        transferId: "t1", subject: { kind: "player", playerId: "p1", label: "An" }, expiresAt: 100,
      }),
      action("start-owner-transfer", 2, {
        transferId: "t2", subject: { kind: "player", playerId: "p2", label: "Bình" }, expiresAt: 100,
      }),
      action("accept-owner-transfer", 3, { transferId: "t2" }),
      action("accept-owner-transfer", 4, { transferId: "t1" }),
      action("accept-owner-transfer", 5, { transferId: "t1" }),
    ];
    const state = foldEventRoles({ eventCode: CODE, ownerUserId: "owner-old", actions });
    expect(state.owner).toMatchObject({ kind: "player", playerId: "p1" });
    expect(state.pendingTransfer).toBeNull();
    expect(state.managers.some((role) => role.roleId === "former-owner:t1" && role.subject.kind === "account")).toBe(true);
    expect(state.actions.filter((item) => item.type === "accept-owner-transfer")).toHaveLength(1);
  });

  it("chuyển quyền tài khoản cần đủ hai xác nhận và complete idempotent", () => {
    const start = action("start-owner-transfer", 1, {
      transferId: "t1", subject: { kind: "player", playerId: "p1", label: "An" },
      previousOwner: OWNER,
      expiresAt: 100,
    });
    const accept = action("accept-owner-transfer", 2, { transferId: "t1" });
    const early = action("complete-account-transfer", 3, { transferId: "t1", accountUserId: "u-new" });
    const oldConfirm = action("confirm-account-transfer", 4, { transferId: "t1", confirmationSide: "old" });
    const newConfirm = action("confirm-account-transfer", 5, { transferId: "t1", confirmationSide: "new" });
    const complete = action("complete-account-transfer", 6, { transferId: "t1", accountUserId: "u-new" });
    const retry = action("complete-account-transfer", 7, { transferId: "t1", accountUserId: "u-new" });
    const state = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "owner-old",
      actions: [start, accept, early, oldConfirm, newConfirm, complete, retry],
    });
    expect(state.accountTransfer).toMatchObject({
      oldConfirmed: true, newConfirmed: true, completedUserId: "u-new",
    });
    expect(state.actions.filter((item) => item.type === "complete-account-transfer")).toHaveLength(1);
    const replayAfterOwnerCellChanged = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "u-new",
      actions: [start, accept, oldConfirm, newConfirm, complete],
    });
    expect(replayAfterOwnerCellChanged.owner).toMatchObject({ kind: "player", playerId: "p1" });
    expect(replayAfterOwnerCellChanged.managers.some((role) =>
      role.subject.kind === "account" && role.subject.userId === "owner-old",
    )).toBe(true);
  });
});

describe("v0.9 — danh tính và capability", () => {
  it("player role chỉ khớp ô đã nhận bằng cookie/tài khoản tương ứng", () => {
    const subject: RoleSubject = { kind: "player", playerId: "p1", label: "An" };
    expect(subjectMatches(subject, { userId: null, me: player("p1", "device-a") })).toBe(true);
    expect(subjectMatches(subject, { userId: null, me: player("p2", "device-b") })).toBe(false);
    const roles = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "owner-old",
      actions: [action("grant-manager", 1, { roleId: "r1", subject })],
    });
    expect(roleForIdentity(roles, { userId: null, me: player("p1", "device-a") })).toBe("manager");
  });

  it("Chủ device-only có quyền trong buổi nhưng không có quyền cấp tài khoản", () => {
    expect(roleFor({ ownerUserId: "account-old" }, null, "account-old", "manager")).toBe("manager");
    const capabilities = capabilitiesForResolvedRole("owner", false);
    expect(capabilities.canManageRoles && capabilities.canManageStructure).toBe(true);
    expect(capabilities.canCopyEvent || capabilities.canChangePasswords).toBe(false);
    const appAdmin = capabilitiesForResolvedRole("admin", false);
    expect(appAdmin.canManageRoles || appAdmin.canViewIdentityFlags).toBe(false);
  });

  it("chỉ userId không có tiền tố g- mới được coi là Google thật", () => {
    expect(isGuestUser("g-guest")).toBe(true);
    expect(isGuestUser("google-user-1")).toBe(false);
    const state = emptyState(CODE);
    state.players = [
      player("google", "device-google", "google-user-1"),
      player("guest", "device-guest", "g-guest"),
      player("device-only", "device-only"),
    ];
    expect(googleLinkedPlayerIds(state)).toEqual(["google"]);
  });

  it("dạng công khai của vai trò và audit không lộ userId, actor ref hay token", () => {
    const tokenHash = hashRoleInvitation("raw-token-test");
    const roles = foldEventRoles({
      eventCode: CODE,
      ownerUserId: "private-owner-user-id",
      actions: [action("grant-manager", 1, {
        roleId: "r-private",
        inviteId: "i-public",
        tokenHash,
        subject: { kind: "account", userId: "private-manager-user-id", email: "manager@example.com", label: "Phó" },
      })],
    });
    const publicJson = JSON.stringify(publicRoleState(roles));
    expect(publicJson).not.toContain("private-owner-user-id");
    expect(publicJson).not.toContain("private-manager-user-id");
    expect(publicJson).not.toContain(tokenHash);
    const auditJson = JSON.stringify(publicRoleAudit(roles.actions[0]!));
    expect(auditJson).not.toContain("private-owner-ref");
    expect(auditJson).not.toContain(tokenHash);
  });

  it("token một lần không thể đoán, sửa hoặc dùng hash khác", () => {
    const token = newRoleInvitationToken();
    const hash = hashRoleInvitation(token);
    expect(token).not.toBe(hash);
    expect(roleInvitationMatches(token, hash)).toBe(true);
    expect(roleInvitationMatches(`${token}x`, hash)).toBe(false);
    expect(roleInvitationStatus(token, hash, 101, 100)).toBe("valid");
    expect(roleInvitationStatus(token, hash, 100, 100)).toBe("expired");
    expect(roleInvitationStatus(`${token}x`, hash, 100, 100)).toBe("invalid");
  });
});

describe("v0.9 — kho event_roles append-only", () => {
  it("roundtrip action không lưu raw token và đổi owner_user_id cùng lô hoàn tất", async () => {
    const sheets = new FakeSheetsClient();
    const events = new EventRepo(sheets);
    await events.create({
      code: CODE,
      clubId: null,
      name: "TEST V9",
      status: "draft",
      ownerUserId: "owner-old",
      playerPassHash: "",
      adminPassHash: "",
    }, 1);
    const roles = new EventRoleRepo(sheets);
    const token = newRoleInvitationToken();
    const grant = action("grant-manager", 2, {
      roleId: "r1",
      inviteId: "i1",
      tokenHash: hashRoleInvitation(token),
      subject: { kind: "player", playerId: "p1", label: "An" },
    });
    await roles.append(grant);
    expect(JSON.stringify(sheets.dump("event_roles"))).not.toContain(token);
    expect((await roles.list(CODE))[0]).toMatchObject({ roleId: "r1", tokenHash: grant.tokenHash });

    const complete = action("complete-account-transfer", 3, {
      transferId: "t1",
      accountUserId: "owner-new",
    });
    expect(await roles.completeAccountOwnership({
      code: CODE,
      expectedOwnerUserId: "owner-old",
      newOwnerUserId: "owner-new",
      action: complete,
    })).toBe("completed");
    expect((await events.load(CODE))?.record.ownerUserId).toBe("owner-new");
    expect((await roles.list(CODE)).some((item) => item.id === complete.id)).toBe(true);
    expect(await roles.completeAccountOwnership({
      code: CODE,
      expectedOwnerUserId: "owner-old",
      newOwnerUserId: "owner-new",
      action: complete,
    })).toBe("already-completed");
  });
});
