import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
          dark: "#1e40af",
        },
        vk: {
          DEFAULT: "#0077FF",
          hover: "#0066DD",
          dark: "#0055BB",
        },
      },
    },
  },
  plugins: [],
};
export default config;
