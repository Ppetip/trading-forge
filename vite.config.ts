import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isGitHubPages = process.env.DEPLOY_TARGET === "github-pages";

export default defineConfig({
  plugins: [react()],
  base: isGitHubPages ? "/trading-forge/" : "/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"]
  }
});
