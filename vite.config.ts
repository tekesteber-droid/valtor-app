import path from "node:path";
import { pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// Runs your Vercel-style /api/*.js serverless functions locally under plain
// `vite dev`, so the Vercel CLI is not required for local development.
// Each file in /api must default-export a (req, res) => {} handler — same
// shape Vercel expects, so this file also works unmodified when deployed.
function localApiPlugin(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();

        const fnName = req.url.split("?")[0].replace("/api/", "");
        const filePath = path.resolve(__dirname, "api", `${fnName}.js`);

        try {
          // Vercel parses the JSON body for you; plain Node/Vite middleware
          // does not, so do it ourselves.
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf-8");
          (req as any).body = raw ? JSON.parse(raw) : {};

          // Vercel's `res` adds .status()/.json() helpers on top of Node's
          // ServerResponse — polyfill just those two.
          (res as any).status = (code: number) => {
            res.statusCode = code;
            return res;
          };
          (res as any).json = (payload: unknown) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
          };

          // file:// URL + cache-busting query so edits to /api files are
          // picked up without restarting the dev server, and so it resolves
          // correctly on Windows (a raw absolute path is not a valid ESM
          // specifier there).
          const fileUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
          const mod = await import(fileUrl);
          await mod.default(req, res);
        } catch (err) {
          console.error(`[local-api] ${fnName} failed:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
          }
          res.end(JSON.stringify({ error: "Local API handler crashed. Check the terminal." }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite only loads VITE_-prefixed vars into import.meta.env by default.
  // The /api functions need the server-side-only vars too (GROQ_API_KEY,
  // SUPABASE_SERVICE_ROLE_KEY) — loadEnv with an empty prefix pulls in
  // everything from .env, and we copy it onto process.env so the
  // dynamically imported handlers above can read it via process.env.X.
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

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
      localApiPlugin(),
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