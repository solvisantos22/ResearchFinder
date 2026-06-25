import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        rf: {
          black: "#050507",
          panel: "#09080d",
          surface: "#0d0b12",
          border: "#2f293d",
          violet: "#651fff",
          violetSoft: "#7c4dff",
          white: "#f8f7ff",
          muted: "#aaa3bc",
          success: "#34d399",
          warning: "#fbbf24",
          danger: "#fb7185"
        }
      }
    }
  },
  plugins: []
};

export default config;
