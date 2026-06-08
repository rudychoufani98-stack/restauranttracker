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
        brand: {
          green: "#10B981",
          amber: "#F59E0B",
          red: "#EF4444",
          blue: "#3B82F6",
        },
        surface: "#F9FAFB",
        border: "#E5E7EB",
      },
      borderRadius: {
        card: "12px",
      },
      borderWidth: {
        thin: "0.5px",
      },
    },
  },
  plugins: [],
};
export default config;
