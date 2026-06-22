import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
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
