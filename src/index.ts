#!/usr/bin/env node

/**
 * Entry point for the ADO MCP server.
 * Supports stdio (default) and HTTP transports.
 */

import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { selectAuthProvider } from "./auth/select.js";
import type { AdoConfig } from "./auth/types.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";
import { RateLimiter } from "./utils/rate-limiter.js";
import { sanitizeString } from "./utils/sanitize.js";
import { VERSION } from "./utils/version.js";

const API_VERSION_PATTERN = /^\d+\.\d+(-preview(\.\d+)?)?$/;

function loadConfig(): AdoConfig {
  const orgUrl = process.env.ADO_ORG_URL;
  if (!orgUrl) {
    logger.error("ADO_ORG_URL environment variable is required");
    process.exit(1);
  }
  if (!/^https:\/\//i.test(orgUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(orgUrl)) {
    logger.error("ADO_ORG_URL must use https:// (http:// is allowed for localhost only)");
    process.exit(1);
  }

  const apiVersion = process.env.ADO_API_VERSION;
  if (apiVersion && !API_VERSION_PATTERN.test(apiVersion)) {
    logger.error(
      `ADO_API_VERSION "${apiVersion}" is invalid. Expected format: 7.2, 7.2-preview, or 7.2-preview.3`,
    );
    process.exit(1);
  }

  let auth;
  try {
    auth = selectAuthProvider(process.env);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const rateLimit = parseInt(process.env.ADO_RATE_LIMIT ?? "60", 10);
  const rateLimiter = new RateLimiter(isNaN(rateLimit) || rateLimit < 1 ? 60 : rateLimit);

  const readOnly = process.env.ADO_READ_ONLY === "true";
  if (readOnly) {
    logger.info("Read-only mode: write tools are not registered");
  }

  return {
    orgUrl,
    defaultProject: process.env.ADO_DEFAULT_PROJECT,
    auth,
    rateLimiter,
    apiVersion,
    readOnly,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const transportIndex = args.indexOf("--transport");
  if (transportIndex >= 0 && transportIndex === args.length - 1) {
    logger.error("--transport requires a value: stdio or http");
    process.exit(1);
  }
  const transportFlag = transportIndex >= 0 ? args[transportIndex + 1] : "stdio";
  if (!["stdio", "http"].includes(transportFlag)) {
    logger.error(`Unknown transport: ${transportFlag}. Use stdio or http.`);
    process.exit(1);
  }

  const config = loadConfig();
  const server = createServer(config);

  if (transportFlag === "http") {
    // Dynamic import to avoid loading express unless needed
    const { default: express } = await import("express");
    const { StreamableHTTPServerTransport } =
      await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

    const app = express();
    app.use(express.json({ limit: "2mb" }));

    const httpToken = process.env.ADO_HTTP_TOKEN;
    // Loopback only by default; a wider bind requires a bearer token so the
    // endpoint never fronts the PAT unauthenticated beyond localhost.
    const host = process.env.ADO_HTTP_HOST || "127.0.0.1";
    const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(host);
    if (!isLoopback && !httpToken) {
      logger.error(
        "ADO_HTTP_HOST is set to a non-loopback address. Set ADO_HTTP_TOKEN to require " +
          "Authorization: Bearer <token> on /mcp before exposing the server beyond localhost.",
      );
      process.exit(1);
    }

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", server: "azure-devops-local-mcp", version: VERSION });
    });

    // Reject browser-originated cross-site requests (DNS-rebinding protection).
    // Non-browser MCP clients do not send an Origin header and pass through.
    const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
    app.post("/mcp", async (req, res) => {
      const origin = req.headers.origin;
      if (origin && !LOOPBACK_ORIGIN.test(origin)) {
        res.status(403).json({ error: "Forbidden origin" });
        return;
      }
      if (httpToken) {
        const expected = Buffer.from(`Bearer ${httpToken}`);
        const provided = Buffer.from(req.headers.authorization ?? "");
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
      }
      // Stateless mode: a fresh server + transport per request, per SDK guidance
      const requestServer = createServer(config);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on("close", () => {
        transport.close().catch(() => {});
        requestServer.close().catch(() => {});
      });
      await requestServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const port = parseInt(process.env.PORT || "3100", 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      logger.error("PORT must be a number between 1 and 65535");
      process.exit(1);
    }
    const httpServer = app.listen(port, host, () => {
      logger.info(`azure-devops-local-mcp HTTP server listening on ${host}:${port}`);
    });

    const shutdown = async () => {
      logger.info("Shutting down gracefully...");
      httpServer.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    // SIGTERM is not supported on Windows; guard to avoid unhandled-signal warnings
    if (process.platform !== "win32") {
      process.on("SIGTERM", shutdown);
    }
  } else {
    // Default: stdio transport for Claude Code
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("azure-devops-local-mcp started on stdio transport");

    const shutdown = async () => {
      logger.info("Shutting down gracefully...");
      await transport.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    // SIGTERM is not supported on Windows; guard to avoid unhandled-signal warnings
    if (process.platform !== "win32") {
      process.on("SIGTERM", shutdown);
    }
  }
}

main().catch((err) => {
  logger.error("Fatal error", { error: sanitizeString(String(err)) });
  process.exit(1);
});
