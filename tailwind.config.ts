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
        //
        //  MARQUE : le bleu marine et l'orange du logo.
        //    · marine  #1B2B5E → structure : titres, textes forts, boutons au repos, focus
        //    · orange  #CC4409 → interaction : état actif, survol, puces de navigation
        //  L'orange vif du logo (#FF6A1A) sert aux graphiques, aux lueurs et au logo :
        //  partout où il n'y a pas de texte à poser dessus. En aplat sous du texte blanc
        //  il est trop clair (2,9:1), d'où la version soutenue #CC4409 (4,8:1) — lisible.
        //
        //  SENS (ne pas repeindre aux couleurs de la marque, sous peine de rendre
        //  « bon » et « alerte » indiscernables) :
        //    · vert / emerald → positif (marge, food cost sous l'objectif, entrée de stock)
        //    · amber          → à surveiller
        //    · red            → négatif
        surface: "#F7FAFC",
        background: "#F7FAFC",
        "surface-container-lowest": "#FFFFFF",
        "surface-container-low": "#F1F3F7",
        "surface-container": "#EAEDF3",
        "surface-container-high": "#E4E8EF",
        "surface-container-highest": "#DFE3EB",
        "surface-variant": "#DFE3EB",
        "on-surface": "#181C22",
        "on-surface-variant": "#414A5C",
        outline: "#737C8C",
        "outline-variant": "#C3C9D6",
        primary: "#1B2B5E",
        "primary-container": "#CC4409",
        "on-primary": "#FFFFFF",
        "on-primary-container": "#FFFFFF",
        "primary-fixed": "#C9D4F0",
        "primary-fixed-dim": "#8FA6DF",
        "inverse-primary": "#8FA6DF",
        secondary: "#555F71",
        "secondary-container": "#D6E0F6",
        tertiary: "#4A5568",
        "tertiary-fixed": "#E3E9F7",
        "error-container": "#FFDAD6",
        "on-error": "#FFFFFF",
        // Orange vif du logo — graphiques, lueurs, aplats décoratifs sans texte.
        brand: { orange: "#FF6A1A", "orange-deep": "#CC4409", navy: "#1B2B5E", "navy-light": "#2C3F7A" },

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

        // Rampe verte SÉMANTIQUE : ce qui va bien (marge positive, food cost sous
        // l'objectif, entrée de stock, réception validée). Elle ne suit pas la
        // marque — la repeindre en orange rendrait « bon » indiscernable de
        // « à surveiller », qui est juste à côté dans le même code couleur.
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
