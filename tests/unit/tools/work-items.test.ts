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
  it("registers work item tools without throwing", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const config = createConfig();

    registerWorkItemsTools(server, config);

    // McpServer doesn't expose a public list, so we just verify registration
    // succeeded (no duplicate-name collisions, no schema errors).
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

describe("Work item links (LINK_TYPE_TO_REL)", () => {
  it("maps friendly names to Azure DevOps relation reference names", async () => {
    const { LINK_TYPE_TO_REL } = await import("../../../src/clients/work-items-client.js");

    expect(LINK_TYPE_TO_REL.parent).toBe("System.LinkTypes.Hierarchy-Reverse");
    expect(LINK_TYPE_TO_REL.child).toBe("System.LinkTypes.Hierarchy-Forward");
    expect(LINK_TYPE_TO_REL.related).toBe("System.LinkTypes.Related");
    expect(LINK_TYPE_TO_REL.predecessor).toBe("System.LinkTypes.Dependency-Reverse");
    expect(LINK_TYPE_TO_REL.successor).toBe("System.LinkTypes.Dependency-Forward");
    expect(LINK_TYPE_TO_REL.duplicate).toBe("System.LinkTypes.Duplicate-Forward");
    expect(LINK_TYPE_TO_REL["duplicate-of"]).toBe("System.LinkTypes.Duplicate-Reverse");
  });
});

describe("WorkItemsClient.addRelation", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a json-patch 'add' to /relations/- with Hierarchy-Reverse for linkType=parent", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 8376,
          rev: 4,
          url: "https://dev.azure.com/testorg/_apis/wit/workItems/8376",
          fields: { "System.Title": "task", "System.State": "New" },
          relations: [],
        }),
    });
    globalThis.fetch = mockFetch;

    const client = new WorkItemsClient(createConfig());
    const result = await client.addRelation(8376, 8325, "parent", { project: "Test" });

    expect(result.id).toBe(8376);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/_apis/wit/workitems/8376");
    // Link ops pin to the stable api-version because 7.2 is rejected as preview-only.
    expect(url).toContain("api-version=7.1");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json-patch+json",
    );

    const body = JSON.parse(init.body as string);
    expect(body).toEqual([
      {
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: "https://dev.azure.com/testorg/_apis/wit/workItems/8325",
        },
      },
    ]);
  });

  it("includes an attributes.comment when supplied", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 1,
          rev: 1,
          url: "",
          fields: { "System.Title": "x" },
          relations: [],
        }),
    });
    globalThis.fetch = mockFetch;

    const client = new WorkItemsClient(createConfig());
    await client.addRelation(1, 2, "related", { project: "Test", comment: "blocks UI work" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body[0].value.attributes).toEqual({ comment: "blocks UI work" });
  });

  it("rejects self-links", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");
    const client = new WorkItemsClient(createConfig());

    await expect(client.addRelation(42, 42, "related", { project: "Test" })).rejects.toThrow(
      /itself/i,
    );
  });
});

describe("WorkItemsClient.removeRelation", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("looks up the relation by target id+rel, then removes by index with a rev test op", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        // GET current work item
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 8376,
            rev: 7,
            url: "",
            fields: { "System.Title": "task" },
            relations: [
              {
                rel: "System.LinkTypes.Related",
                url: "https://dev.azure.com/testorg/_apis/wit/workItems/999",
                attributes: {},
              },
              {
                rel: "System.LinkTypes.Hierarchy-Reverse",
                url: "https://dev.azure.com/testorg/_apis/wit/workItems/8325",
                attributes: {},
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        // PATCH response
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 8376,
            rev: 8,
            url: "",
            fields: { "System.Title": "task" },
            relations: [],
          }),
      });
    globalThis.fetch = mockFetch;

    const client = new WorkItemsClient(createConfig());
    const result = await client.removeRelation(8376, 8325, "parent", { project: "Test" });

    expect(result.id).toBe(8376);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Both the GET lookup and the PATCH pin to api-version=7.1.
    for (const call of mockFetch.mock.calls) {
      expect(call[0]).toContain("api-version=7.1");
    }

    const patchInit = mockFetch.mock.calls[1][1] as RequestInit;
    expect(patchInit.method).toBe("PATCH");
    const body = JSON.parse(patchInit.body as string);
    expect(body).toEqual([
      { op: "test", path: "/rev", value: 7 },
      { op: "remove", path: "/relations/1" },
    ]);
  });

  it("errors when the requested link does not exist", async () => {
    const { WorkItemsClient } = await import("../../../src/clients/work-items-client.js");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 8376,
          rev: 1,
          url: "",
          fields: { "System.Title": "task" },
          relations: [],
        }),
    });

    const client = new WorkItemsClient(createConfig());
    await expect(client.removeRelation(8376, 8325, "parent", { project: "Test" })).rejects.toThrow(
      /No parent link/,
    );
  });
});
