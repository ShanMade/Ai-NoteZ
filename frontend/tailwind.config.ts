import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      spacing: {
        0.5: "0.125rem",
        1.5: "0.375rem",
        2.5: "0.625rem",
        4.5: "1.125rem",
        6.5: "1.625rem",
        18: "4.5rem",
      },
      fontFamily: {
        sans: ["var(--font-body)", "sans-serif"],
        display: ["var(--font-display)", "serif"],
        mono: ["var(--font-mono)", "monospace"],
        urdu: ["var(--font-urdu)", "serif"],
      },
      colors: {
        canvas: "var(--surface)",
        panel: "var(--surface-raised)",
        ink: "var(--text-primary)",
        muted: "var(--text-muted)",
        line: "var(--border)",
        accent: "var(--accent)",
      },
      transitionDuration: {
        180: "180ms",
        220: "220ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
