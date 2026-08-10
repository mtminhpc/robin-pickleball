"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eventQueryPrefix, useEvent } from "@/hooks/useEventState";
import { useAccount } from "@/hooks/useAccount";
import { Button, Card, Field, inputClass } from "@/components/ui";

interface PublicSubject {
  kind: "account" | "player" | "pending-email";
  playerId?: string;
  email?: string;
  label: string;
}

interface PublicRoleState {
  revision: number;
  maxManagers: number;
  owner: PublicSubject | null;
  managers: Array<{
    roleId: string;
    subject: PublicSubject;
    status: "pending" | "active";
    inviteId: string | null;
    expiresAt: number | null;
    createdAt: number;
    source: string;
  }>;
  pendingTransfer: null | {
    transferId: string;
    target: PublicSubject;
    expiresAt: number;
    inviteId: string | null;
  };
  accountTransfer: null | {
    transferId: string;
    oldConfirmed: boolean;
    newConfirmed: boolean;
    completed: boolean;
  };
}

interface RawInvitation {
  inviteId: string;
  token: string;
  expiresAt: number;
  url: string;
}

interface DisplayInvitation extends RawInvitation {
  identityKey: string;
}

interface AuditItem {
  id: string;
  actorLabel: string;
  at: number;
  type: string;
  effectiveRound: number | null;
  summary: string;
}

export function RoleManager({ code }: { code: string }) {
  const { data, refresh } = useEvent();
  const account = useAccount();
  const client = useQueryClient();
  const [managerPlayerId, setManagerPlayerId] = useState("");
  const [ownerPlayerId, setOwnerPlayerId] = useState("");
  const [email, setEmail] = useState("");
  const [invitation, setInvitation] = useState<DisplayInvitation | null>(null);
  const [error, setError] = useState("");
  const canView = Boolean(data?.capabilities.canViewIdentityFlags);
  const identityKey = account.data?.user?.userId ?? data?.myPlayerId ?? "device";
  const roles = useQuery<PublicRoleState>({
    queryKey: ["event-roles", code, identityKey],
    queryFn: () => api<PublicRoleState>(`/api/events/${code}/roles`),
    staleTime: 10_000,
    enabled: canView,
  });
  const change = useMutation({
    mutationFn: async (input: {
      kind: "grant" | "revoke" | "transfer" | "cancel-transfer" | "confirm-account";
      roleId?: string;
      playerId?: string;
      email?: string;
    }) => {
      if (input.kind === "revoke") {
        return api(`/api/events/${code}/roles/${encodeURIComponent(input.roleId ?? "")}`, { method: "DELETE" });
      }
      if (input.kind === "cancel-transfer") {
        return api(`/api/events/${code}/ownership-transfer`, { method: "DELETE" });
      }
      if (input.kind === "confirm-account") {
        return api(`/api/events/${code}/account-ownership-transfer/confirm`, { method: "POST" });
      }
      const endpoint = input.kind === "transfer"
        ? `/api/events/${code}/ownership-transfer`
        : `/api/events/${code}/roles`;
      return api<{ invitation?: RawInvitation | null }>(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: input.playerId || undefined, email: input.email || undefined }),
      });
    },
    onSuccess: (body) => {
      setError("");
      if (body && typeof body === "object" && "invitation" in body) {
        const raw = (body as { invitation?: RawInvitation | null }).invitation;
        setInvitation(raw ? { ...raw, identityKey } : null);
      }
      setEmail("");
      setManagerPlayerId("");
      setOwnerPlayerId("");
      void client.invalidateQueries({ queryKey: ["event-roles", code] });
      void client.invalidateQueries({ queryKey: eventQueryPrefix(code) });
      refresh();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Không cập nhật được vai trò."),
  });

  if (!data?.capabilities.canViewIdentityFlags) return null;
  const canManage = data.capabilities.canManageRoles;
  const roleData = roles.data;
  const candidates = data.state.players.filter((player) =>
    !roleData?.managers.some((manager) => manager.subject.playerId === player.id) &&
    roleData?.owner?.playerId !== player.id,
  );

  return (
    <>
      <Card className="space-y-4 p-5">
        <div>
          <p className="eyebrow text-accent">Trao quyền</p>
          <h2 className="mt-1 font-semibold">Chủ và Phó sự kiện</h2>
          <p className="mt-2 text-sm text-mute-700">
            Chủ hiện tại: {roleData?.owner?.label ?? "Chưa xác định"}. Tối đa {roleData?.maxManagers ?? 5} Phó.
          </p>
        </div>

        {canManage && (
          <div className="grid gap-3 border-y border-line py-4 md:grid-cols-2">
            <Field label="Cấp Phó theo người chơi">
              <select value={managerPlayerId} onChange={(event) => setManagerPlayerId(event.target.value)} className={inputClass}>
                <option value="">Chọn người chơi…</option>
                {candidates.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select>
            </Field>
            <div className="flex items-end">
              <Button full disabled={!managerPlayerId || change.isPending} onClick={() => change.mutate({ kind: "grant", playerId: managerPlayerId })}>
                Cấp quyền Phó
              </Button>
            </div>
            <Field label="Hoặc mời bằng email">
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ten@gmail.com" className={inputClass} />
            </Field>
            <div className="flex items-end">
              <Button full disabled={!email.trim() || change.isPending} onClick={() => change.mutate({ kind: "grant", email })}>
                Mời email
              </Button>
            </div>
          </div>
        )}

        {roles.isLoading && <p className="text-sm text-mute-600">Đang tải vai trò…</p>}
        {(roles.error || error) && <p className="text-sm text-accent-700">{error || (roles.error as Error).message}</p>}
        <div className="divide-y divide-line border-y border-line">
          {(roleData?.managers ?? []).map((manager) => {
            const google = manager.subject.playerId
              ? data.googleLinkedPlayerIds?.includes(manager.subject.playerId)
              : manager.subject.kind === "account";
            return (
              <div key={manager.roleId} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{manager.subject.label}</p>
                  <p className="text-xs text-mute-600">
                    {manager.status === "pending" ? "Chờ nhận ô" : "Phó đang hoạt động"}
                    {google ? " · Google" : " · thiết bị"}
                  </p>
                </div>
                {canManage && (
                  <Button tone="danger" disabled={change.isPending} onClick={() => change.mutate({ kind: "revoke", roleId: manager.roleId })}>
                    Thu hồi
                  </Button>
                )}
              </div>
            );
          })}
          {roleData?.managers.length === 0 && <p className="py-4 text-sm text-mute-600">Chưa có Phó sự kiện.</p>}
        </div>

        {invitation?.identityKey === identityKey && (
          <div className="border-2 border-ink bg-surface p-4">
            <p className="font-semibold">Link/QR chỉ hiện lần này</p>
            <p className="mt-2 break-all text-xs">{invitation.url}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/events/${code}/role-invitations/${encodeURIComponent(invitation.inviteId)}/qr?token=${encodeURIComponent(invitation.token)}`}
              alt="QR lời mời quản lý một lần"
              className="mt-3 size-40 border border-line bg-white p-2"
            />
            <Button className="mt-3" onClick={() => void navigator.clipboard.writeText(invitation.url)}>Sao chép link</Button>
          </div>
        )}

        {canManage && !roleData?.pendingTransfer && (
          <div className="grid gap-3 border-t border-line pt-4 md:grid-cols-[1fr_auto]">
            <Field label="Chuyển Chủ vận hành cho người chơi">
              <select value={ownerPlayerId} onChange={(event) => setOwnerPlayerId(event.target.value)} className={inputClass}>
                <option value="">Chọn người nhận…</option>
                {data.state.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select>
            </Field>
            <div className="flex items-end">
              <Button tone="danger" disabled={!ownerPlayerId || change.isPending} onClick={() => change.mutate({ kind: "transfer", playerId: ownerPlayerId })}>
                Khởi tạo chuyển Chủ
              </Button>
            </div>
          </div>
        )}
        {roleData?.pendingTransfer && (
          <div className="border border-line p-3 text-sm">
            <p>Đang chờ <strong>{roleData.pendingTransfer.target.label}</strong> chấp nhận chuyển Chủ.</p>
            {canManage && <Button tone="danger" className="mt-3" onClick={() => change.mutate({ kind: "cancel-transfer" })}>Huỷ yêu cầu</Button>}
          </div>
        )}
        {roleData?.accountTransfer && !roleData.accountTransfer.completed && (
          <div className="border border-line p-3 text-sm">
            <p>Chuyển Chủ vận hành đã xong. Hai phía xác nhận để chuyển danh sách sở hữu và quota tài khoản.</p>
            <p className="mt-1 text-xs text-mute-600">
              Chủ cũ: {roleData.accountTransfer.oldConfirmed ? "đã xác nhận" : "đang chờ"} · Chủ mới: {roleData.accountTransfer.newConfirmed ? "đã xác nhận" : "đang chờ"}
            </p>
            <Button className="mt-3" disabled={change.isPending} onClick={() => change.mutate({ kind: "confirm-account" })}>
              Xác nhận phía tôi
            </Button>
          </div>
        )}
      </Card>
      <AuditLog code={code} />
    </>
  );
}

function AuditLog({ code }: { code: string }) {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [cursor, setCursor] = useState<string | null>("0");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async (next: string) => {
    setLoading(true);
    try {
      const body = await api<{ items: AuditItem[]; nextCursor: string | null }>(`/api/events/${code}/audit?cursor=${encodeURIComponent(next)}`);
      setItems((current) => next === "0" ? body.items : [...current, ...body.items]);
      setCursor(body.nextCursor);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được nhật ký.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load("0"); }, [code]);
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">Nhật ký quản lý</h2>
      <div className="divide-y divide-line border-y border-line">
        {items.map((item) => (
          <div key={item.id} className="py-3 text-sm">
            <p className="font-semibold">{item.summary}</p>
            <p className="mt-1 text-xs text-mute-600">
              {item.actorLabel} · {new Date(item.at).toLocaleString("vi-VN")}
              {item.effectiveRound ? ` · từ vòng ${item.effectiveRound}` : ""}
            </p>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-accent-700">{error}</p>}
      {cursor && <Button full disabled={loading} onClick={() => void load(cursor)}>{loading ? "Đang tải…" : "Xem thêm"}</Button>}
    </Card>
  );
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Yêu cầu không thành công.");
  return body;
}
