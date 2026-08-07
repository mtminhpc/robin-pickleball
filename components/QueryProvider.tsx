"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Cấu hình mặc định nhắm vào một thực tế: điện thoại ở sân hay rớt sóng vài giây
 * rồi có lại. Nên thử lại vài lần với khoảng chờ tăng dần thay vì báo lỗi ngay,
 * và luôn tải lại khi người dùng quay lại tab.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 3,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
            refetchOnWindowFocus: true,
            staleTime: 2_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
