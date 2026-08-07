"use client";

/**
 * Đọc một câu lạc bộ.
 *
 * Hỏi lại thưa hơn hẳn sự kiện (60 giây so với 3): danh bạ mỗi tháng đổi vài
 * lần, còn tỷ số thì đổi từng phút. Hỏi dồn ở đây chỉ tổ đốt hạn mức Sheets vào
 * thứ gần như không bao giờ thay đổi.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Club, ClubMember } from "@/lib/domain/club";

export type ClubRole = "owner" | "member" | "guest";

export interface ClubSnapshot {
  club: Club;
  members: ClubMember[];
  me: ClubMember | null;
  role: ClubRole;
}

const POLL_MS = 60_000;

export function clubQueryKey(id: string) {
  return ["club", id] as const;
}

export function useClub(id: string) {
  return useQuery<ClubSnapshot>({
    queryKey: clubQueryKey(id),
    queryFn: async () => {
      const res = await fetch(`/api/clubs/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Không tải được câu lạc bộ.");
      }
      return res.json() as Promise<ClubSnapshot>;
    },
    refetchInterval: POLL_MS,
    retry: false,
  });
}

/**
 * Gửi một thay đổi lên danh bạ.
 *
 * Không dùng hàng đợi ngoại tuyến như lúc nhập điểm, và đó là chủ ý: sửa danh bạ
 * là việc làm lúc rảnh ở nhà, không phải giữa sân lúc mất sóng. Hỏng thì báo lỗi
 * rồi để người dùng bấm lại, đơn giản và dễ hiểu hơn nhiều.
 */
export function useClubMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      path?: string;
      method?: "POST" | "PATCH";
      body: unknown;
    }) => {
      const res = await fetch(
        `/api/clubs/${encodeURIComponent(id)}${input.path ?? ""}`,
        {
          method: input.method ?? "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không lưu được.");
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clubQueryKey(id) });
    },
  });
}
