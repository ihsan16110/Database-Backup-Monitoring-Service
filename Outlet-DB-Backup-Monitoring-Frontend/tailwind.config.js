/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#007bff",
        background: "#f0f0f0",
        text: "#333",
      },
    },
  },
  plugins: [],
}
