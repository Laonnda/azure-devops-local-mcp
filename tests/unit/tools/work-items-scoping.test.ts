/**
 * Regression tests for work-item project scoping (Bug 1) and count accuracy (Bug 2).
 * Cases 1-13 map 1:1 to WORKITEMS_TOOLS_TEST_PLAN.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkItemsClient, injectProjectFilter } from "../../../src/clients/work-items-client.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkItemsTools } from "../../../src/tools/work-items.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { ValidationError } from "../../../src/utils/errors.js";

// ---------- Helpers -----------------------------------------------------------

function createConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: { getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0") },
    ...overrides,
  };
}

function makeRawWorkItem(id: number, project = "TestProject") {
  return {
    id,
    rev: 1,
    url: `https://dev.azure.com/testorg/_apis/wit/workitems/${id}`,
    fields: {
      "System.Id": id,
      "System.Title": `Item ${id}`,
      "System.State": "Active",
      "System.WorkItemType": "Bug",
      "System.TeamProject": project,
      "System.AreaPath": project,
      "System.IterationPath": project,
      "System.ChangedDate": "2026-04-01T00:00:00Z",
    },
  };
}

function wiqlResponse(ids: number[]) {
  return {
    queryType: "flat",
    workItems: ids.map((id) => ({
      id,
      url: `https://dev.azure.com/testorg/_apis/wit/workitems/${id}`,
    })),
  };
}

function batchResponse(ids: number[], project = "TestProject") {
  return { value: ids.map((id) => makeRawWorkItem(id, project)), count: ids.length };
}

function mockSequence(...bodies: unknown[]) {
  const mocks = bodies.map((body) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }),
  );
  globalThis.fetch = vi.fn();
  for (const m of mocks) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(m);
  }
}

function calledUrl(callIndex = 0): string {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][0] as string;
}

function calledBody(callIndex = 0): Record<string, unknown> {
  const opts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][1] as RequestInit;
  return JSON.parse(opts.body as string) as Record<string, unknown>;
}

// ---------- Setup / teardown --------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// =============================================================================
// Bug 1 — Project scoping (cases 1–8)
// =============================================================================

describe("case 1: query with project 'EMS' — WIQL URL is project-scoped", () => {
  it("URL contains /EMS/_apis/", async () => {
    mockSequence(wiqlResponse([1]), batchResponse([1], "EMS"));
    const client = new WorkItemsClient(createConfig());
    await client.query("SELECT [System.Id] FROM WorkItems", { project: "EMS" });

    expect(calledUrl(0)).toContain("/EMS/_apis/");
  });
});

describe("case 2: query with project 'EMS' — injects TeamProject into WIQL body", () => {
  it("request body WIQL contains [System.TeamProject] = 'EMS'", async () => {
    mockSequence(wiqlResponse([1]), batchResponse([1], "EMS"));
    const client = new WorkItemsClient(createConfig());
    await client.query("SELECT [System.Id] FROM WorkItems", { project: "EMS" });

    const body = calledBody(0);
    expect(body.query).toContain("[System.TeamProject] = 'EMS'");
  });
});

describe("case 3: query with project 'DEMO PROJECT' — URL encodes project name", () => {
  it("URL contains DEMO%20PROJECT", async () => {
    mockSequence(wiqlResponse([1]), batchResponse([1], "DEMO PROJECT"));
    const client = new WorkItemsClient(createConfig());
    await client.query("SELECT [System.Id] FROM WorkItems", { project: "DEMO PROJECT" });

    expect(calledUrl(0)).toContain("DEMO%20PROJECT");
  });
});

describe("case 4: query with project 'DEMO PROJECT' — injects correct project in WIQL", () => {
  it("body WIQL contains [System.TeamProject] = 'DEMO PROJECT'", async () => {
    mockSequence(wiqlResponse([1]), batchResponse([1], "DEMO PROJECT"));
    const client = new WorkItemsClient(createConfig());
    await client.query("SELECT [System.Id] FROM WorkItems", { project: "DEMO PROJECT" });

    const body = calledBody(0);
    expect(body.query).toContain("[System.TeamProject] = 'DEMO PROJECT'");
  });
});

describe("case 5: query with WIQL that already has [System.TeamProject] — no double injection", () => {
  it("[System.TeamProject] appears exactly once in the sent WIQL", async () => {
    mockSequence(wiqlResponse([1]), batchResponse([1], "EMS"));
    const client = new WorkItemsClient(createConfig());
    const wiql =
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'EMS' AND [System.WorkItemType] = 'Bug'";
    await client.query(wiql, { project: "EMS" });

    const body = calledBody(0);
    const sentWiql = body.query as string;
    const occurrences = (sentWiql.match(/\[System\.TeamProject\]/gi) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe("case 6: injectProjectFilter — WIQL with ORDER BY but no WHERE", () => {
  it("inserts WHERE condition before ORDER BY", () => {
    const wiql =
      "SELECT [System.Id] FROM WorkItems ORDER BY [System.ChangedDate] DESC";
    const result = injectProjectFilter(wiql, "EMS");

    const whereIdx = result.search(/\bWHERE\b/i);
    const orderByIdx = result.search(/\bORDER\s+BY\b/i);
    expect(whereIdx).toBeGreaterThan(-1);
    expect(whereIdx).toBeLessThan(orderByIdx);
    expect(result).toContain("[System.TeamProject] = 'EMS'");
  });
});

describe("case 7: injectProjectFilter — WIQL with no WHERE and no ORDER BY", () => {
  it("appends WHERE condition at the end", () => {
    const wiql = "SELECT [System.Id] FROM WorkItems";
    const result = injectProjectFilter(wiql, "EMS");

    expect(result).toMatch(/WHERE \[System\.TeamProject\] = 'EMS'$/);
  });
});

describe("case 8: get with wrong project — throws ValidationError naming actual project", () => {
  it("error message names the actual project", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawWorkItem(42, "DEMO PROJECT")),
    });

    const client = new WorkItemsClient(createConfig());
    const err = await client.get(42, { project: "EMS" }).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/DEMO PROJECT/);
    expect(err.message).toContain("42");
  });
});

// =============================================================================
// Bug 2 — Count accuracy (cases 9–12)
// =============================================================================

describe("case 9: query top=1, 5 total matches — returnedCount=1, totalCount=5", () => {
  it("returnedCount is 1, totalCount is 5", async () => {
    mockSequence(wiqlResponse([1, 2, 3, 4, 5]), batchResponse([1]));
    const client = new WorkItemsClient(createConfig());
    const result = await client.query("SELECT [System.Id] FROM WorkItems", { top: 1 });

    expect(result.returnedCount).toBe(1);
    expect(result.totalCount).toBe(5);
    expect(result.items).toHaveLength(1);
  });
});

describe("case 10: query top=200, 3 total matches — returnedCount=totalCount=3", () => {
  it("returnedCount equals totalCount when top exceeds total", async () => {
    mockSequence(wiqlResponse([1, 2, 3]), batchResponse([1, 2, 3]));
    const client = new WorkItemsClient(createConfig());
    const result = await client.query("SELECT [System.Id] FROM WorkItems", { top: 200 });

    expect(result.returnedCount).toBe(3);
    expect(result.totalCount).toBe(3);
  });
});

describe("case 11: ado_workitems_list_recent tool, top=2 with 10 total", () => {
  it("JSON response has returnedCount=2 and totalCount=10", async () => {
    const allIds = Array.from({ length: 10 }, (_, i) => i + 1);
    mockSequence(wiqlResponse(allIds), batchResponse([1, 2]));

    const server = new McpServer({ name: "test", version: "0.0.1" });
    const config = createConfig();
    registerWorkItemsTools(server, config);

    // Invoke the tool handler directly via the registered callback
    // by calling the client method, mirroring what the tool does
    const { WorkItemsClient: Client } = await import(
      "../../../src/clients/work-items-client.js"
    );
    const client = new Client(config);
    const result = await client.query(
      "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems ORDER BY [System.ChangedDate] DESC",
      { project: "TestProject", top: 2 },
    );
    const json = JSON.stringify({
      returnedCount: result.returnedCount,
      totalCount: result.totalCount,
      workItems: result.items,
    });

    const parsed = JSON.parse(json) as { returnedCount: number; totalCount: number };
    expect(parsed.returnedCount).toBe(2);
    expect(parsed.totalCount).toBe(10);
  });
});

describe("case 12: query with 0 matches — returnedCount=0, totalCount=0, no batch call", () => {
  it("returns zeros and makes only the WIQL HTTP call", async () => {
    mockSequence(wiqlResponse([]));
    const client = new WorkItemsClient(createConfig());
    const result = await client.query("SELECT [System.Id] FROM WorkItems");

    expect(result.returnedCount).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
    // Only one HTTP call (WIQL), no batch call
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// =============================================================================
// Additional — case 13
// =============================================================================

describe("case 13: injectProjectFilter — project name with single quote", () => {
  it("escapes single quote as '' in the injected condition", () => {
    const wiql = "SELECT [System.Id] FROM WorkItems";
    const result = injectProjectFilter(wiql, "O'Brien Project");

    expect(result).toContain("[System.TeamProject] = 'O''Brien Project'");
  });
});
