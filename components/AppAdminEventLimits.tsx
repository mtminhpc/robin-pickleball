"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Field, inputClass } from "@/components/ui";

interface LimitRow { email: string; limit: number | null; grantedBy: string; updatedAt: number }

export function AppAdminEventLimits() {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [limit, setLimit] = useState("3");
  const query = useQuery<{ limits: LimitRow[] }>({
    queryKey: ["app-admin", "event-limits"],
    queryFn: async () => {
      const response = await fetch("/api/app-admin/event-limits");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Không tải được hạn mức.");
      return body;
    },
  });
  const save = useMutation({
    mutationFn: async (input: { email: string; limit: number | null; remove?: boolean }) => {
      const response = await fetch(input.remove ? `/api/app-admin/event-limits?email=${encodeURIComponent(input.email)}` : "/api/app-admin/event-limits", {
        method: input.remove ? "DELETE" : "PUT",
        headers: { "content-type": "application/json" },
        ...(input.remove ? {} : { body: JSON.stringify({ email: input.email, limit: input.limit }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Không lưu được hạn mức.");
    },
    onSuccess: () => { setEmail(""); void client.invalidateQueries({ queryKey: ["app-admin", "event-limits"] }); },
  });

  return (
    <Card className="space-y-4 border-2 border-ink p-5">
      <div><p className="eyebrow text-accent">App admin</p><h2 className="mt-1 text-lg">Hạn mức tạo sự kiện</h2><p className="mt-1 text-xs text-mute-600">Chỉ điều chỉnh số sự kiện chưa kết thúc. Không cấp quyền xem mật khẩu hoặc sửa sự kiện.</p></div>
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]" onSubmit={(event) => { event.preventDefault(); save.mutate({ email, limit: limit === "unlimited" ? null : Number(limit) }); }}>
        <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} required /></Field>
        <Field label="Hạn mức"><select value={limit} onChange={(event) => setLimit(event.target.value)} className={inputClass}><option value="unlimited">Không giới hạn</option>{Array.from({ length: 98 }, (_, index) => index + 3).map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
        <Button type="submit" tone="primary" className="self-end" disabled={save.isPending}>Lưu</Button>
      </form>
      {save.error && <p className="text-sm text-accent-700">{(save.error as Error).message}</p>}
      <div className="divide-y divide-line border-y border-line">
        {query.data?.limits.map((row) => <div key={row.email} className="flex min-h-12 items-center gap-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{row.email}</span><strong className="shrink-0">{row.limit ?? "Không giới hạn"}</strong><button type="button" className="min-h-10 px-2 text-xs text-accent-700 underline" onClick={() => save.mutate({ email: row.email, limit: 3, remove: true })}>Mặc định</button></div>)}
        {!query.isLoading && (query.data?.limits.length ?? 0) === 0 && <p className="py-4 text-center text-xs text-mute-600">Chưa có hạn mức tùy chỉnh.</p>}
      </div>
    </Card>
  );
}
