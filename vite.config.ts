import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mochaPlugins } from "@getmocha/vite-plugins";

export default defineConfig({
  plugins: [...mochaPlugins(process.env), react()],

  server: {
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Forward cookies
            const cookie = req.headers["cookie"];
            if (cookie) proxyReq.setHeader("cookie", cookie);

            // Forward Authorization header (THIS FIXES YOUR ISSUE)
            const auth = req.headers["authorization"];
            if (auth) proxyReq.setHeader("authorization", auth);
          });
        },
      },
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    chunkSizeWarningLimit: 5000,
  },
});
