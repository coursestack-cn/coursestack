import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { fileURLToPath, URL } from "node:url";

// A development-only sink for real XHR progress tests. Never stores request bodies.
function uploadPreviewEndpoint(): Plugin {
    return {
        name: "coursestack-upload-preview",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const path = (request.url ?? "").split("?")[0];
                const match = /^\/__dev\/upload\/([a-zA-Z0-9_-]+)$/.exec(path ?? "");
                if (!match) { next(); return; }
                response.setHeader("Cache-Control", "no-store");
                if (request.method !== "PUT") {
                    response.setHeader("Allow", "PUT");
                    response.statusCode = 405;
                    response.end();
                    return;
                }
                request.on("error", () => { if (!response.destroyed) response.destroy(); });
                request.on("end", () => {
                    if (response.destroyed || request.aborted) return;
                    response.statusCode = match[1]?.startsWith("fail-") ? 500 : 204;
                    response.end();
                });
                request.resume();
            });
        }
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "DEV_");

    return {
        plugins: [svelte(), uploadPreviewEndpoint()],
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