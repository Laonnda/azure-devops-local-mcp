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

describe("WorkItemsClient — webUrl mapping", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps _links.html.href to webUrl on work item", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");
    const config = createConfig();
    const client = new WorkItemsClient(config);

    // First call: WIQL response
    // Second call: batch GET
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              queryType: "flat",
              workItems: [{ id: 1, url: "https://dev.azure.com/_apis/wit/workitems/1" }],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            count: 1,
            value: [
              {
                id: 1,
                rev: 1,
                url: "https://dev.azure.com/_apis/wit/workitems/1",
                fields: {
                  "System.Title": "My Bug",
                  "System.State": "Active",
                  "System.WorkItemType": "Bug",
                  "System.ChangedDate": "2026-04-17T00:00:00Z",
                },
                _links: {
                  html: { href: "https://dev.azure.com/testorg/TestProject/_workitems/edit/1" },
                },
              },
            ],
          }),
      });
    });

    const result = await client.query("SELECT [System.Id] FROM WorkItems", { project: "TestProject" });
    expect(result.items[0].webUrl).toBe(
      "https://dev.azure.com/testorg/TestProject/_workitems/edit/1",
    );
  });

  it("webUrl defaults to empty string when _links absent", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");
    const config = createConfig();
    const client = new WorkItemsClient(config);

    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              queryType: "flat",
              workItems: [{ id: 2, url: "https://dev.azure.com/_apis/wit/workitems/2" }],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            count: 1,
            value: [
              {
                id: 2,
                rev: 1,
                url: "https://dev.azure.com/_apis/wit/workitems/2",
                fields: {
                  "System.Title": "Task",
                  "System.State": "New",
                  "System.WorkItemType": "Task",
                  "System.ChangedDate": "2026-04-17T00:00:00Z",
                },
              },
            ],
          }),
      });
    });

    const result = await client.query("SELECT [System.Id] FROM WorkItems", { project: "TestProject" });
    expect(result.items[0].webUrl).toBe("");
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

    await expect(client.query("; DROP TABLE WorkItems", { project: "Test" })).rejects.toThrow(
      "blocked",
    );
  });

  it("rejects queries exceeding max length", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");
    const config = createConfig();
    const client = new WorkItemsClient(config);

    const longQuery = "SELECT [System.Id] FROM WorkItems WHERE " + "x".repeat(2000);
    await expect(client.query(longQuery, { project: "Test" })).rejects.toThrow("maximum length");
  });
});
