/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--cor-base)",
        superficie: "var(--cor-superficie)",
        acento: "var(--cor-acento)",
        sucesso: "var(--cor-sucesso)",
        alerta: "var(--cor-alerta)",
        borda: "var(--cor-borda)",
        texto: "var(--cor-texto)",
        "texto-muted": "var(--cor-texto-muted)",
      },
      fontFamily: {
        display: ["var(--fonte-display)", "serif"],
        corpo: ["var(--fonte-corpo)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
