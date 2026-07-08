import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

function localApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: "local-api-check-analysis",
    configureServer(server) {
      server.middlewares.use("/api/check-analysis", async (req: any, res: any) => {
        Object.assign(process.env, env); // exposes GROQ_API_KEY etc. to the handler, same as Vercel does in prod
        const { default: handler } = await import("./api/check-analysis.js");

        let raw = "";
        req.on("data", (chunk: Buffer) => (raw += chunk));
        req.on("end", async () => {
          try {
            req.body = raw ? JSON.parse(raw) : {};
            res.status = (code: number) => {
              res.statusCode = code;
              return res;
            };
            res.json = (data: unknown) => {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(data));
            };
            await handler(req, res);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Local API adapter failed", detail: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // "" = load ALL vars, not just VITE_-prefixed ones
  return {
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: "./src/routes",
        generatedRouteTree: "./src/routeTree.gen.ts",
        quoteStyle: "double",
        semicolons: true,
      }),
      react(),
      tailwindcss(),
      localApiPlugin(env),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ["recharts"],
            excel: ["xlsx"],
            supabase: ["@supabase/supabase-js"],
            vendor: ["react", "react-dom", "@tanstack/react-router"],
          },
        },
      },
    },
  };
});