"use client";

/**
 * Ô nhập mật khẩu để lấy quyền nhập điểm.
 *
 * Hiện dưới dạng thẻ gọn nằm trong trang chứ không phải hộp thoại chắn ngang:
 * xem bảng xếp hạng là quyền mở cho mọi người, nên người chỉ ghé xem không bị
 * chặn đường. Ai cần nhập điểm thì thẻ này ở ngay đó.
 *
 * Dưới ô mật khẩu là lối đăng nhập Google, dành cho **người tạo ra buổi này mà
 * quên mất mật khẩu**. Trước đây quên mật khẩu chủ sự kiện là hết đường: buổi
 * đánh thành chỉ-đọc vĩnh viễn, không có ai để hỏi lại. Tài khoản đã tạo ra buổi
 * thì lấy lại quyền được, và không mượn của nhau được như mật khẩu.
 */

import { useState } from "react";
import { usePathname } from "next/navigation";
import { signInHref, useAccount } from "@/hooks/useAccount";
import { useEvent } from "@/hooks/useEventState";
import { Button, Card, inputClass } from "@/components/ui";

export function PasswordGate({ code }: { code: string }) {
  const { refresh } = useEvent();
  const account = useAccount();
  const pathname = usePathname();
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

      {/* Chỉ hiện khi máy chủ có bật OAuth và người xem chưa đăng nhập. Một nút
          bấm vào là ra trang lỗi thì tệ hơn hẳn không có nút nào — cùng lý lẽ
          với `AccountBar`. */}
      {account.data?.enabled && !account.data.user && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-mute-700">
          Bạn tạo buổi này mà quên mật khẩu?{" "}
          <a
            href={signInHref(pathname)}
            className="font-semibold text-accent-700 underline underline-offset-4"
          >
            Đăng nhập bằng Google
          </a>{" "}
          để lấy lại quyền chủ sự kiện.
        </p>
      )}
    </Card>
  );
}
