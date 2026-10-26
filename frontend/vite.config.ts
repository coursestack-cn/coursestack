import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "DEV_");

    return {
        plugins: [svelte()],
        resolve: {
            alias: {
                $lib: fileURLToPath(new URL("./src/lib", import.meta.url))
            }
        },
        server: {
            host: "127.0.0.1",
            port: 5173,
            strictPort: true,
            proxy: {
                "^/api(?:[/?]|$)": {
                    target: env.DEV_API_TARGET || "http://127.0.0.1:8787",
                    changeOrigin: false
                }
            }
        }
    };
});