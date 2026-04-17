#!/usr/bin/env node

/**
 * Entry point for the ADO MCP server.
 * Supports stdio (default) and HTTP transports.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { selectAuthProvider } from "./auth/select.js";
import type { AdoConfig } from "./auth/types.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

const API_VERSION_PATTERN = /^\d+\.\d+(-preview(\.\d+)?)?$/;

function loadConfig(): AdoConfig {
  const orgUrl = process.env.ADO_ORG_URL;
  if (!orgUrl) {
    logger.error("ADO_ORG_URL environment variable is required");
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

  return {
    orgUrl,
    defaultProject: process.env.ADO_DEFAULT_PROJECT,
    auth,
    apiVersion,
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
    app.use(express.json());

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", server: "ado-mcp", version: "0.1.0" });
    });

    app.post("/mcp", async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on("close", () => {
        transport.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const port = parseInt(process.env.PORT || "3100", 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      logger.error("PORT must be a number between 1 and 65535");
      process.exit(1);
    }
    app.listen(port, () => {
      logger.info(`ado-mcp HTTP server listening on port ${port}`);
    });
  } else {
    // Default: stdio transport for Claude Code
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("ado-mcp started on stdio transport");
  }
}

main().catch((err) => {
  logger.error("Fatal error", { error: String(err) });
  process.exit(1);
});
