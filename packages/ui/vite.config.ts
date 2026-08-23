import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

export default defineConfig(({ mode, command }) => {
  // Load .env from repo root (not packages/ui CWD)
  const env = loadEnv(mode, REPO_ROOT, "");

  const PAAW_PORT = process.env.PAAW_PORT || env.PAAW_PORT || env.VITE_PAAW_PORT || "4097";
  const PAAW_WS_PORT = process.env.PAAW_WS_PORT || env.PAAW_WS_PORT || env.VITE_PAAW_WS_PORT || "4098";
  const VITE_PORT = parseInt(process.env.VITE_PORT || env.VITE_PORT || "5173", 10);

  return {
    plugins: [react()],
    // API/WS port 只在 dev server（vite serve）烙入 — 5173 頁面要指到真 API port。
    // production build（vite build）不烙：UI 由 PAAW server 自己 serve，
    // 前端 fallback 用頁面 host / port+1，部署在任何 port 都正確。
    // （烙死 4097 的包裝在非 4097 port 會全部 API 打錯地方）
    define: command === "serve" ? {
      "import.meta.env.VITE_PAAW_PORT": JSON.stringify(PAAW_PORT),
      "import.meta.env.VITE_PAAW_WS_PORT": JSON.stringify(PAAW_WS_PORT),
    } : {},
    server: {
      port: VITE_PORT,
      strictPort: false,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${PAAW_PORT}`,
          changeOrigin: true,
        },
        '/a2a': {
          target: `http://127.0.0.1:${PAAW_PORT}`,
          changeOrigin: true,
        },
      },
    },
  };
});
