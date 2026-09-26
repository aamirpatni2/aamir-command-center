/**
 * Production: the API also serves the built dashboard (apps/web/dist), so the browser talks to one
 * origin (the SameSite=Strict session cookie and CSRF model assume it) and the HTML gets a strict
 * Content-Security-Policy. In development Vite serves the app instead.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";

/**
 * No inline or third-party scripts; styles only from our own files (React's style props go
 * through the CSSOM, which CSP doesn't block); API calls only to this origin.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Registers static serving on the root instance and returns the fallback for the not-found
 * handler: client-side routes (/leads, /approvals/…) get the app shell; /api stays JSON.
 */
export async function registerWeb(app: FastifyInstance, dir: string) {
  const root = resolve(dir);
  if (!existsSync(resolve(root, "index.html"))) throw new Error(`WEB_DIST_DIR has no index.html: ${root} (run pnpm build:web)`);

  const sendIndex = (reply: FastifyReply) =>
    reply.header("content-security-policy", WEB_CSP).header("cache-control", "no-cache").type("text/html; charset=utf-8").sendFile("index.html", root);

  await app.register(fastifyStatic, {
    root,
    index: false,
    wildcard: false,
    cacheControl: false, // we set it ourselves below
    setHeaders(res, path) {
      // Vite fingerprints everything under /assets: cache forever. Anything else briefly.
      res.setHeader("cache-control", path.startsWith(resolve(root, "assets")) ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    },
  });
  app.get("/", async (_req, reply) => sendIndex(reply));

  return (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/assets/") && (req.headers.accept ?? "").includes("text/html")) {
      return sendIndex(reply);
    }
    return null;
  };
}
