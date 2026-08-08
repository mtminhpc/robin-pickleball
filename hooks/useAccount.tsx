"use client";

/**
 * Ai đang đăng nhập, và hai nút để đổi điều đó.
 *
 * Câu trả lời được đệm lâu (5 phút) vì nó gần như không đổi trong một phiên, và
 * mỗi trang mở ra lại hỏi một lần là tốn lượt đọc bảng tài khoản cho không.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface AccountInfo {
  email: string;
  displayName: string;
  avatarId: string;
  picture: string;
  devices: number;
}

export interface SessionInfo {
  /** Máy chủ có cấu hình đăng nhập Google hay không. */
  enabled: boolean;
  user: AccountInfo | null;
}

export const ACCOUNT_KEY = ["auth", "session"];

export function useAccount() {
  return useQuery<SessionInfo>({
    queryKey: ACCOUNT_KEY,
    queryFn: async () => {
      const res = await fetch("/api/auth/session");
      if (!res.ok) throw new Error("Không đọc được trạng thái đăng nhập.");
      return (await res.json()) as SessionInfo;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/session", { method: "DELETE" });
      if (!res.ok) throw new Error("Không đăng xuất được.");
    },
    onSuccess: () => {
      // Số liệu ở trang "Của tôi" thu hẹp lại về đúng máy này, nên phải tính lại
      // chứ không để người dùng nhìn con số của tài khoản vừa rời khỏi.
      queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** Sang Google rồi quay về đúng trang đang đứng. */
export function signInHref(next: string): string {
  return `/api/auth/google/start?next=${encodeURIComponent(next)}`;
}
