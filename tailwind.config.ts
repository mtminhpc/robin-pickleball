import type { Config } from "tailwindcss";

/**
 * Bảng màu và cỡ chữ nhắm vào điều kiện thật: điện thoại cầm một tay, ngoài nắng,
 * người dùng vừa đánh xong đang thở dốc. Nên tương phản cao, chữ to, nút to.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./hooks/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        court: {
          50: "#eefbf3",
          100: "#d6f5e3",
          500: "#16a34a",
          600: "#15803d",
          700: "#166534",
        },
      },
      fontSize: {
        // Cỡ dành riêng cho tỷ số: phải đọc được khi điện thoại đặt trên ghế.
        score: ["3.5rem", { lineHeight: "1", fontWeight: "800" }],
      },
      minHeight: {
        // Vùng bấm tối thiểu cho ngón tay ướt mồ hôi.
        tap: "3rem",
      },
    },
  },
  plugins: [],
};

export default config;
