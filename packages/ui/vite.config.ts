import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const PAAW_PORT = process.env.PAAW_PORT || env.VITE_PAAW_PORT || "4097";
  const PAAW_WS_PORT = process.env.PAAW_WS_PORT || env.VITE_PAAW_WS_PORT || "4098";
  const VITE_PORT = parseInt(process.env.VITE_PORT || env.VITE_PORT || "5173", 10);

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_PAAW_PORT": JSON.stringify(PAAW_PORT),
      "import.meta.env.VITE_PAAW_WS_PORT": JSON.stringify(PAAW_WS_PORT),
    },
    server: {
      port: VITE_PORT,
      strictPort: false,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${PAAW_PORT}`,
          changeOrigin: true,
        },
      },
    },
  };
});
