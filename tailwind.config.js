/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    // This is the crucial part: tell Tailwind where your files are
    "./index.html", // Path to your public/index.html (or similar)
    "./src/**/*.{js,jsx,ts,tsx}", // Path to your React components (JS, JSX, TS, TSX files in src and subfolders)
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}