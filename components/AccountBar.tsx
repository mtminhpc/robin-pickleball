"use client";

/**
 * Dải đăng nhập bằng tài khoản Google.
 *
 * Ba trạng thái, và cái thứ ba quan trọng nhất: **máy chủ chưa cấu hình OAuth
 * thì không vẽ gì cả**. Hiện một nút bấm vào là ra trang lỗi thì tệ hơn hẳn so
 * với không hiện nút nào — người dùng đâu có cách nào biết đó là chuyện của máy
 * chủ chứ không phải họ làm sai.
 *
 * Khi đã đăng nhập, dòng chữ nói thẳng số máy đang được gộp. Câu "số liệu của
 * bạn nằm trên 2 máy" trả lời trước cái thắc mắc duy nhất mà người ta có ở đây:
 * *rốt cuộc cái này có tác dụng gì*.
 */

import { useEffect, useState } from "react";
import { signInHref, useAccount, useSignOut } from "@/hooks/useAccount";
import { Avatar } from "@/components/Avatar";
import { Card } from "@/components/ui";

/** Câu quay về từ Google, đọc từ `?dangnhap=`. */
const OUTCOMES: Record<string, string> = {
  huy: "Bạn đã huỷ ở màn hình Google. Chưa có gì thay đổi.",
  hethan: "Lần đăng nhập đó đã quá hạn. Bấm lại lần nữa.",
  loi: "Không đăng nhập được. Thử lại, hoặc xem nhật ký máy chủ nếu bạn tự chạy.",
  chuacaidat: "Máy chủ này chưa bật đăng nhập Google.",
};

export function AccountBar({ next }: { next: string }) {
  const { data } = useAccount();
  const signOut = useSignOut();
  const outcome = OUTCOMES[useLoginOutcome() ?? ""];

  // Chưa biết thì chưa vẽ. Nhấp nháy một nút đăng nhập rồi rút đi trông như lỗi.
  if (!data?.enabled) return null;

  if (!data.user) {
    return (
      <Card className="space-y-3 p-4">
        {outcome && <p className="text-sm text-amber-300">{outcome}</p>}
        <a
          href={signInHref(next)}
          className="flex min-h-tap items-center justify-center gap-2 rounded-xl bg-slate-800 px-5 font-semibold text-slate-100 transition hover:bg-slate-700"
        >
          <GoogleMark />
          Đăng nhập bằng Google
        </a>
        <p className="text-xs text-slate-500">
          Không bắt buộc. Đăng nhập để số liệu theo bạn sang điện thoại khác thay
          vì nằm lại trên máy này.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex items-center gap-3 p-4">
      <Avatar name={data.user.displayName} avatarId={data.user.avatarId} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{data.user.displayName}</p>
        <p className="truncate text-xs text-slate-500">
          {data.user.email}
          {data.user.devices > 1 && ` · gộp ${data.user.devices} máy`}
        </p>
      </div>
      <button
        className="shrink-0 px-2 text-sm text-slate-400 hover:text-slate-100 disabled:opacity-40"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Đăng xuất
      </button>
    </Card>
  );
}

/**
 * Đọc `?dangnhap=` thẳng từ thanh địa chỉ.
 *
 * Cố ý không dùng `useSearchParams`: cái đó buộc trang phải nằm trong một
 * `Suspense`, mà đây chỉ là một câu thông báo hiện sau khi quay về từ Google.
 * Không đáng đổi bố cục của mọi trang lấy nó.
 */
function useLoginOutcome(): string | null {
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    setOutcome(new URLSearchParams(window.location.search).get("dangnhap"));
  }, []);
  return outcome;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M45 24c0-1.6-.1-2.7-.4-4H24v7.5h12c-.2 2-1.5 5-4.4 7l6.8 5.3C42.4 36.2 45 30.6 45 24z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.4-5.2l-6.8-5.3c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.9-12.5-9.2l-7 5.4C8 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7-5.4C3.3 17 2.5 20.4 2.5 24s.8 7 2.5 9.9l6.5-5.4z"
      />
      <path
        fill="#EA4335"
        d="M24 10.6c3.3 0 6.1 1.1 8.4 3.3l6-6C34.9 4.5 29.9 2 24 2 15.4 2 8 6.9 4.5 14.1l7 5.4C13.3 14.5 18.2 10.6 24 10.6z"
      />
    </svg>
  );
}
