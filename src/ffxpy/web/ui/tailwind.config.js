/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Drop Tailwind's default named fonts (SFMono-Regular, Menlo,
        // Consolas, "Liberation Mono", "Courier New", ...) -- if any of
        // those happen to be installed, they'd match before the stack ever
        // reaches the generic `monospace` keyword, bypassing whatever the
        // OS actually has configured as its default monospace font.
        mono: ['ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
