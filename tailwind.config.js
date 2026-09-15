/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./stats.html"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Noto Sans TC", "system-ui", "sans-serif"],
        serif: ["Noto Serif TC", "Songti TC", "Georgia", "serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
