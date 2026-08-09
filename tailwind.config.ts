import type { Config } from "tailwindcss";

/**
 * Bảng màu "Modernist", lấy từ bộ bàn giao của Claude Design.
 *
 * Đây là **nguồn sự thật duy nhất** cho phần nhìn. Tên đặt theo vai trò chứ không
 * theo màu (`paper`, `ink`, `accent`) — đổi tông cả ứng dụng thì sửa ở đây, không
 * phải đi lùng từng tệp.
 *
 * Đặc trưng của hệ này: **không bo góc**. Bán kính bị ép về 0 ở mọi cỡ, nên
 * `rounded-xl` còn sót lại đâu đó cũng tự phẳng ra thay vì lạc lõng một mình.
 * Riêng `rounded-full` giữ nguyên, vì ảnh đại diện vẫn tròn.
 *
 * Ứng dụng trước đây dùng nền tối. Đổi sang nền sáng là quyết định của bản thiết
 * kế, và nó có cái được cái mất — xem `globals.css`.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./hooks/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /** Nền trang. */
        paper: "#f3f2f2",
        /** Nền của khối nổi lên khỏi trang: thẻ, ô nhập, hộp thoại. */
        surface: "#eae9e9",
        /** Chữ, và nền của các dải tối (thanh bên, băng tiêu đề). */
        ink: "#201e1d",
        /** Đường kẻ. Mờ 40% nên nằm được trên cả nền sáng lẫn nền tối. */
        line: "rgb(32 30 29 / 0.4)",

        /**
         * Thang trung tính. Cùng một bậc của thang này và thang nhấn có độ sáng
         * bằng nhau, nên đổi qua lại không bị nhảy đậm nhạt.
         */
        mute: {
          100: "#f8f4f4",
          200: "#eae7e7",
          300: "#d7d3d3",
          400: "#bab6b6",
          500: "#9b9797",
          600: "#7d7979",
          700: "#605d5d",
          800: "#444141",
          900: "#2d2b2b",
        },

        /** Màu nhấn. Dùng cho việc đang diễn ra và nút chính, đừng rải khắp nơi. */
        accent: {
          DEFAULT: "#ec3013",
          100: "#fff2ef",
          200: "#ffe0d9",
          300: "#ffc4b8",
          400: "#ff9783",
          500: "#ff563c",
          600: "#dd2b0f",
          700: "#ae1800",
          800: "#7c1405",
          900: "#4d170e",
        },
      },

      fontFamily: {
        // Một họ chữ cho tất cả. Phân cấp bằng độ đậm và cỡ, không bằng đổi phông.
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
        display: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },

      fontSize: {
        // Cỡ dành riêng cho tỷ số: phải đọc được khi điện thoại đặt trên ghế.
        score: ["2.375rem", { lineHeight: "0.9", letterSpacing: "-0.04em", fontWeight: "800" }],
        // Tiêu đề "VÒNG 6" trên băng tối.
        display: ["2.125rem", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "800" }],
      },

      borderRadius: {
        none: "0",
        sm: "0",
        DEFAULT: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        full: "9999px",
      },

      minHeight: {
        // Vùng bấm tối thiểu cho ngón tay ướt mồ hôi.
        tap: "3rem",
      },

      boxShadow: {
        sm: "0 1px 2px rgb(45 43 43 / 0.14)",
        DEFAULT: "0 3px 10px rgb(45 43 43 / 0.16)",
        md: "0 3px 10px rgb(45 43 43 / 0.16)",
        lg: "0 12px 32px rgb(45 43 43 / 0.22)",
      },
    },
  },
  plugins: [],
};

export default config;
