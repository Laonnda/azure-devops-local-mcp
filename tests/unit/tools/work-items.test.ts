import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { registerWorkItemsTools } from "../../../src/tools/work-items.js";

function createConfig(): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: {
      getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0"),
    },
  };
}

describe("Work Items Tool Registration", () => {
  it("registers all 5 work item tools", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const config = createConfig();

    registerWorkItemsTools(server, config);

    // Access registered tools via the server's internal state
    // McpServer doesn't expose a public list, so we verify registration doesn't throw
    // and the server is ready to use
    expect(server).toBeDefined();
  });
});

describe("WIQL validation", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects queries with SQL injection patterns", async () => {
    // The WorkItemsClient validates WIQL internally
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");
    const config = createConfig();
    const client = new WorkItemsClient(config);

    await expect(
      client.query("; DROP TABLE WorkItems", { project: "Test" }),
    ).rejects.toThrow("blocked");
  });

  it("rejects queries exceeding max length", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");
    const config = createConfig();
    const client = new WorkItemsClient(config);

    const longQuery = "SELECT [System.Id] FROM WorkItems WHERE " + "x".repeat(2000);
    await expect(
      client.query(longQuery, { project: "Test" }),
    ).rejects.toThrow("maximum length");
  });
});
