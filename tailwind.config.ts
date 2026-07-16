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
        sans: ["var(--font-hanken)", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        // ── Material 3 design tokens (Amaly) ──
        surface: "#F7FAFC",
        background: "#F7FAFC",
        "surface-container-lowest": "#FFFFFF",
        "surface-container-low": "#F1F4F6",
        "surface-container": "#EBEEF0",
        "surface-container-high": "#E5E9EB",
        "surface-container-highest": "#E0E3E5",
        "surface-variant": "#E0E3E5",
        "on-surface": "#181C1E",
        "on-surface-variant": "#3D4A43",
        outline: "#6D7A72",
        "outline-variant": "#BCCAC1",
        primary: "#00694B",
        "primary-container": "#008560",
        "on-primary": "#FFFFFF",
        "on-primary-container": "#F5FFF7",
        "primary-fixed": "#84F8C8",
        "primary-fixed-dim": "#67DBAD",
        "inverse-primary": "#67DBAD",
        secondary: "#555F71",
        "secondary-container": "#D6E0F6",
        tertiary: "#525F5A",
        "tertiary-fixed": "#D8E5E0",
        "error-container": "#FFDAD6",
        "on-error": "#FFFFFF",

        // Legacy aliases kept so existing screens keep compiling
        "card": "#FFFFFF",
        "border-default": "#E5E7EB",
        "border-strong": "#D1D5DB",
        "text-primary": "#111827",
        "text-secondary": "#6B7280",
        "text-tertiary": "#9CA3AF",
        green: { DEFAULT: "#00694B", light: "#D8F5E7", dark: "#003A28" },
        amber: { DEFAULT: "#F59E0B", light: "#FEF3C7", dark: "#92400E" },
        red: { DEFAULT: "#BA1A1A", light: "#FFDAD6", dark: "#93000A" },
        blue: { DEFAULT: "#3B82F6", light: "#DBEAFE", dark: "#1E40AF" },

        // The whole app is written with emerald-* utilities: remapping this ramp
        // onto the Material 3 green re-skins every screen at once.
        emerald: {
          50: "#F0FDF7",
          100: "#D8F5E7",
          200: "#A8EBCD",
          300: "#67DBAD",
          400: "#22B785",
          500: "#008560",
          600: "#00694B",
          700: "#005139",
          800: "#003A28",
          900: "#002115",
          950: "#001A10",
        },
      },
      borderRadius: {
        DEFAULT: "8px",
        card: "12px",
        xl: "12px",
        lg: "8px",
        md: "8px",
        sm: "6px",
        full: "9999px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.03)",
        "card-hover": "0 4px 12px -2px rgb(16 24 40 / 0.08), 0 2px 6px -2px rgb(16 24 40 / 0.04)",
        modal: "0 24px 64px -12px rgb(16 24 40 / 0.20), 0 0 0 1px rgb(16 24 40 / 0.04)",
        sm: "0 1px 2px 0 rgb(16 24 40 / 0.04)",
        inner: "inset 0 1px 3px 0 rgb(16 24 40 / 0.05)",
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
