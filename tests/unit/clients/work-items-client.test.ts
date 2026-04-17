import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkItemsClient } from "../../../src/clients/work-items-client.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import type { AdoConfig } from "../../../src/auth/types.js";

function createConfig(): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: { getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0") },
    rateLimiter: new RateLimiter(60),
  };
}

function makeWorkItem(id: number) {
  return {
    id,
    rev: 1,
    url: `https://dev.azure.com/_apis/wit/workitems/${id}`,
    fields: {
      "System.Title": `Item ${id}`,
      "System.State": "Active",
      "System.WorkItemType": "Task",
      "System.ChangedDate": "2026-04-17T00:00:00Z",
      "System.AssignedTo": "",
      "System.AreaPath": "TestProject",
      "System.IterationPath": "TestProject",
    },
  };
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("WorkItemsClient — batch fetch pagination", () => {
  it("splits >200 IDs into multiple requests", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const wiqlResponse = { queryType: "flat", workItems: ids.map((id) => ({ id, url: "" })) };

    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(wiqlResponse),
        });
      }
      // Batch calls: return items for current chunk
      const callNum = call - 1;
      const start = (callNum - 1) * 200;
      const slice = ids.slice(start, start + 200);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ count: slice.length, value: slice.map(makeWorkItem) }),
      });
    });

    const client = new WorkItemsClient(createConfig());
    const result = await client.query("SELECT [System.Id] FROM WorkItems", {
      project: "TestProject",
      top: 250,
    });

    // 1 WIQL call + 2 batch calls (200 + 50)
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect(result.items).toHaveLength(250);
  });
});

describe("WorkItemsClient — create work item", () => {
  it("sends JSON Patch document and returns mapped detail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(makeWorkItem(99)),
    });

    const client = new WorkItemsClient(createConfig());
    const item = await client.create("TestProject", "Task", { "System.Title": "My task" });

    expect(item.id).toBe(99);
    expect(item.title).toBe("Item 99");

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Array<{ op: string; path: string; value: unknown }>;
    expect(body.some((p) => p.path === "/fields/System.Title" && p.value === "My task")).toBe(true);
  });
});

describe("WorkItemsClient — description truncation", () => {
  it("truncates long descriptions to 500 chars", async () => {
    const longDesc = "x".repeat(600);
    const raw = {
      ...makeWorkItem(1),
      fields: { ...makeWorkItem(1).fields, "System.Description": longDesc },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(raw),
    });

    const client = new WorkItemsClient(createConfig());
    const item = await client.get(1, { project: "TestProject" });
    expect(item.description.length).toBeLessThan(longDesc.length);
    expect(item.description).toContain("truncated");
  });
});
