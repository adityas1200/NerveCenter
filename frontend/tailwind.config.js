import palette from "./scripts/palette-families.cjs";

const { themedFamilies } = palette;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        display: ['"Inter"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        /** The Home greeting only (SPEC-projects-03 FR-24); the footer wordmark draws the same face on canvas. */
        serif: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        micro: ["10.5px", { lineHeight: "1.2" }],
        tiny: ["11px", { lineHeight: "1.25" }],
        caption: ["11.5px", { lineHeight: "1.35" }],
        meta: ["12.5px", { lineHeight: "1.45" }],
        control: ["13px", { lineHeight: "1.5" }],
        "control-lg": ["13.5px", { lineHeight: "1.5" }],
        "body-sm": ["14px", { lineHeight: "1.55" }],
        body: ["14.5px", { lineHeight: "1.6" }],
        copy: ["15px", { lineHeight: "1.7" }],
        "heading-sm": ["15px", { lineHeight: "1.25" }],
        "heading-md": ["16px", { lineHeight: "1.25" }],
        "dialog-title": ["17px", { lineHeight: "1.25" }],
        "section-title": ["20px", { lineHeight: "1.2" }],
        "page-title": ["28px", { lineHeight: "1.18" }],
        metric: ["30px", { lineHeight: "1" }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        surface: {
          DEFAULT: "rgb(var(--c-surface) / <alpha-value>)",
          base: "rgb(var(--c-base) / <alpha-value>)",
          raised: "rgb(var(--c-raised) / <alpha-value>)",
          tint: "rgb(var(--c-tint) / <alpha-value>)",
          blue: "rgb(var(--c-tint) / <alpha-value>)",
          panel: "rgb(var(--c-panel) / <alpha-value>)",
          subtle: "rgb(var(--c-subtle) / <alpha-value>)",
          hover: "rgb(var(--c-hover) / <alpha-value>)",
        },
        /** A card's own surface: white in light, the raised grey in dark. Use instead of bg-white. */
        raised: "rgb(var(--c-raised) / <alpha-value>)",
        /** Above its surroundings: an active segment, a chip on a track. White in light, a lighter grey in dark. */
        elevated: "rgb(var(--c-elevated) / <alpha-value>)",
        ink: {
          1: "rgb(var(--c-ink-1) / <alpha-value>)",
          2: "rgb(var(--c-ink-2) / <alpha-value>)",
          3: "rgb(var(--c-ink-3) / <alpha-value>)",
          4: "rgb(var(--c-ink-4) / <alpha-value>)",
          5: "rgb(var(--c-ink-5) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--c-line) / <alpha-value>)",
          blue: "rgb(var(--c-line) / <alpha-value>)",
          soft: "rgb(var(--c-line-soft) / <alpha-value>)",
          strong: "rgb(var(--c-line-strong) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "rgb(var(--c-brand) / <alpha-value>)",
          hover: "rgb(var(--c-brand-hover) / <alpha-value>)",
          soft: "rgb(var(--c-brand-soft) / <alpha-value>)",
          deep: "#1E2A4A",
          indigo: "rgb(var(--c-brand-ink) / <alpha-value>)",
          violet: "#7C3AED",
          blue: "#2563EB",
          cyan: "#0891B2",
          orange: "#EA580C",
          dark: "#09090B",
          on: "rgb(var(--c-on-brand) / <alpha-value>)",
        },
        ...themedFamilies(),
      },
      borderRadius: {
        lg: "var(--radius)",
        xl: "10px",
        "2xl": "12px",
        "3xl": "18px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        soft: "var(--shadow-pop)",
        panel: "var(--shadow-pop)",
        pop: "var(--shadow-pop)",
        modal: "var(--shadow-modal)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(3px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "drawer-in": {
          from: { opacity: "0.7", transform: "translateX(28px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "value-swap": {
          from: { opacity: "0.35" },
          to: { opacity: "1" },
        },
        shimmer: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        "drawer-in": "drawer-in 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        "value-swap": "value-swap 0.16s ease-out both",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
