import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

// All paths resolve relative to THIS FILE so the build works from any cwd.
//   __dirname  = .../Site/Public/STATIC/Build   (the SPA source root)
//   STATIC_ROOT = .../Site/Public/STATIC        (build tools + output live here)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = path.resolve(__dirname, "..");

export default defineConfig({
    root: __dirname,
    base: "/",
    build: {
        outDir: path.join(STATIC_ROOT, "frontend"),
        emptyOutDir: true,
        rollupOptions: {
            output: {
                entryFileNames: "assets/js/[name]-[hash].js",
                chunkFileNames: "assets/js/[name]-[hash].js",
                assetFileNames: (assetInfo) => {
                    const name = assetInfo.name || "";
                    if (/\.css$/i.test(name)) return "assets/css/[name]-[hash][extname]";
                    if (/\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/i.test(name))
                        return "assets/img/[name]-[hash][extname]";
                    return "assets/[name]-[hash][extname]";
                },
            },
        },
    },
});
