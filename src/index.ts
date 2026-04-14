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

function loadConfig(): AdoConfig {
  const orgUrl = process.env.ADO_ORG_URL;
  if (!orgUrl) {
    logger.error("ADO_ORG_URL environment variable is required");
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
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const transportFlag = args.includes("--transport")
    ? args[args.indexOf("--transport") + 1]
    : "stdio";

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
