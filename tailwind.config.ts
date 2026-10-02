import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f4f6ff",
          100: "#e8ecff",
          200: "#c7d0ff",
          300: "#a3b0ff",
          400: "#7c8bff",
          500: "#5b67f5",
          600: "#454fd1",
          700: "#343ca6",
          800: "#282f80",
          900: "#1f255f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
