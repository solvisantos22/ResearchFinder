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
          muted: "#aaa3bc"
        },
        ink: "#1f2933",
        paper: "#f8fafc",
        line: "#d8dee9",
        accent: "#0f766e"
      }
    }
  },
  plugins: []
};

export default config;
