"use client";

/**
 * Ô nhập mật khẩu để lấy quyền nhập điểm.
 *
 * Hiện dưới dạng thẻ gọn nằm trong trang chứ không phải hộp thoại chắn ngang:
 * xem bảng xếp hạng là quyền mở cho mọi người, nên người chỉ ghé xem không bị
 * chặn đường. Ai cần nhập điểm thì thẻ này ở ngay đó.
 */

import { useState } from "react";
import { useEvent } from "@/hooks/useEventState";
import { Button, Card, inputClass } from "@/components/ui";

export function PasswordGate({ code }: { code: string }) {
  const { refresh } = useEvent();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${code}/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Không vào được.");
        return;
      }
      setPassword("");
      refresh();
    } catch {
      setError("Không nối được máy chủ. Kiểm tra mạng rồi thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-mute-800">
          Bạn đang ở chế độ xem. Nhập mật khẩu để nhập điểm.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mật khẩu"
            autoComplete="off"
            className={inputClass}
          />
          <Button tone="primary" type="submit" disabled={busy || !password}>
            Vào
          </Button>
        </div>
        {error && <p className="text-sm text-accent-700">{error}</p>}
      </form>
    </Card>
  );
}
