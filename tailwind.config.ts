import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        surface: "#F9FAFB",
        "card": "#FFFFFF",
        "border-default": "#E5E7EB",
        "border-strong": "#D1D5DB",
        "text-primary": "#111827",
        "text-secondary": "#6B7280",
        "text-tertiary": "#9CA3AF",
        green: { DEFAULT: "#10B981", light: "#D1FAE5", dark: "#065F46" },
        amber: { DEFAULT: "#F59E0B", light: "#FEF3C7", dark: "#92400E" },
        red: { DEFAULT: "#EF4444", light: "#FEE2E2", dark: "#991B1B" },
        blue: { DEFAULT: "#3B82F6", light: "#DBEAFE", dark: "#1E40AF" },
      },
      borderRadius: {
        DEFAULT: "8px",
        card: "12px",
        lg: "10px",
        md: "8px",
        sm: "6px",
      },
      boxShadow: {
        card: "0 1px 4px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
        "card-hover": "0 4px 16px 0 rgb(0 0 0 / 0.10), 0 1px 3px -1px rgb(0 0 0 / 0.06)",
        modal: "0 20px 60px -10px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.05)",
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        inner: "inset 0 1px 3px 0 rgb(0 0 0 / 0.06)",
      },
      fontSize: {
        "2xs": ["11px", "16px"],
        xs: ["12px", "18px"],
        sm: ["13px", "20px"],
        base: ["14px", "22px"],
        lg: ["15px", "24px"],
        xl: ["17px", "26px"],
        "2xl": ["20px", "28px"],
      },
    },
  },
  plugins: [],
};
export default config;
