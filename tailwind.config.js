/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        main: "rgb(var(--bg-main) / <alpha-value>)",
        sidebar: "rgb(var(--bg-sidebar) / <alpha-value>)",
        header: "rgb(var(--bg-header) / <alpha-value>)",
        card: "rgb(var(--bg-card) / <alpha-value>)",
        input: "rgb(var(--bg-input) / <alpha-value>)",
        primary: "rgb(var(--text-main) / <alpha-value>)",
        secondary: "rgb(var(--text-secondary) / <alpha-value>)",
        muted: "rgb(var(--text-muted) / <alpha-value>)",
        border: "rgb(var(--border-main) / <alpha-value>)",
        "border-card": "rgb(var(--border-card) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"Golos Text"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
