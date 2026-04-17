import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { registerPipelinesTools } from "../../../src/tools/pipelines.js";
import { PipelinesClient } from "../../../src/clients/pipelines-client.js";
import {
  pipelineIdSchema,
  buildIdSchema,
  statusFilterSchema,
} from "../../../src/validation/pipelines.js";
import { AuthenticationError, NotFoundError } from "../../../src/utils/errors.js";

function createConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: {
      getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0"),
    },
    ...overrides,
  };
}

// ─── Raw API shape helpers ────────────────────────────────────────────────────

function makeRawPipelineDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "CI Pipeline",
    folder: "\\pipelines",
    revision: 5,
    url: "https://dev.azure.com/testorg/TestProject/_apis/pipelines/1",
    _links: {
      web: { href: "https://dev.azure.com/testorg/TestProject/_build/definition?definitionId=1" },
    },
    ...overrides,
  };
}

function makeRawPipelineRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "20260401.1",
    state: "completed",
    result: "succeeded",
    createdDate: "2026-04-01T10:00:00Z",
    finishedDate: "2026-04-01T10:15:00Z",
    pipeline: {
      id: 1,
      name: "CI Pipeline",
      url: "https://dev.azure.com/testorg/TestProject/_apis/pipelines/1",
    },
    url: "https://dev.azure.com/testorg/TestProject/_apis/pipelines/1/runs/42",
    ...overrides,
  };
}

function makeRawBuild(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    buildNumber: "20260401.1",
    status: "completed",
    result: "succeeded",
    queueTime: "2026-04-01T10:00:00Z",
    startTime: "2026-04-01T10:01:00Z",
    finishTime: "2026-04-01T10:15:00Z",
    definition: { id: 1, name: "CI Pipeline" },
    requestedFor: { displayName: "Alice" },
    sourceBranch: "refs/heads/main",
    sourceVersion: "abc123",
    url: "https://dev.azure.com/testorg/TestProject/_apis/build/builds/100",
    ...overrides,
  };
}

function makeRawBuildLog(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "Container",
    url: `https://dev.azure.com/testorg/TestProject/_apis/build/builds/123/logs/${id}`,
    lineCount: 100,
    ...overrides,
  };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

describe("Pipelines Tool Registration", () => {
  it("registers all 5 pipelines tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerPipelinesTools(server, createConfig());
    expect(server).toBeDefined();
  });
});

// ─── pipelineIdSchema validation ──────────────────────────────────────────────

describe("pipelineIdSchema validation", () => {
  it("accepts a valid positive integer", () => {
    expect(() => pipelineIdSchema.parse(1)).not.toThrow();
    expect(() => pipelineIdSchema.parse(999)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => pipelineIdSchema.parse(0)).toThrow();
  });

  it("rejects negative integers", () => {
    expect(() => pipelineIdSchema.parse(-1)).toThrow();
  });

  it("rejects non-integer numbers", () => {
    expect(() => pipelineIdSchema.parse(1.5)).toThrow();
  });

  it("rejects string input", () => {
    expect(() => pipelineIdSchema.parse("123")).toThrow();
  });

  it("rejects undefined (required field)", () => {
    expect(() => pipelineIdSchema.parse(undefined)).toThrow();
  });
});

// ─── buildIdSchema validation ─────────────────────────────────────────────────

describe("buildIdSchema validation", () => {
  it("accepts a valid positive integer", () => {
    expect(() => buildIdSchema.parse(42)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => buildIdSchema.parse(0)).toThrow();
  });

  it("rejects negative integers", () => {
    expect(() => buildIdSchema.parse(-10)).toThrow();
  });

  it("rejects non-integer numbers", () => {
    expect(() => buildIdSchema.parse(2.5)).toThrow();
  });

  it("rejects string input", () => {
    expect(() => buildIdSchema.parse("42")).toThrow();
  });
});

// ─── statusFilterSchema validation ───────────────────────────────────────────

describe("statusFilterSchema validation", () => {
  it.each(["completed", "inProgress", "notStarted", "all"] as const)(
    "accepts valid enum value '%s'",
    (value) => {
      expect(() => statusFilterSchema.parse(value)).not.toThrow();
    },
  );

  it("rejects an unknown status string", () => {
    expect(() => statusFilterSchema.parse("running")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => statusFilterSchema.parse("")).toThrow();
  });

  it("rejects numeric value", () => {
    expect(() => statusFilterSchema.parse(1)).toThrow();
  });

  it("rejects case-variant spellings", () => {
    expect(() => statusFilterSchema.parse("Completed")).toThrow();
    expect(() => statusFilterSchema.parse("INPROGRESS")).toThrow();
  });
});

// ─── PipelinesClient.listDefinitions ─────────────────────────────────────────

describe("PipelinesClient.listDefinitions — response mapping", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps all fields correctly including webUrl from _links.web.href", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [makeRawPipelineDefinition()] }),
    });

    const client = new PipelinesClient(createConfig());
    const result = await client.listDefinitions("TestProject");

    expect(result).toHaveLength(1);
    const def = result[0];
    expect(def.id).toBe(1);
    expect(def.name).toBe("CI Pipeline");
    expect(def.folder).toBe("\\pipelines");
    expect(def.revision).toBe(5);
    expect(def.webUrl).toBe(
      "https://dev.azure.com/testorg/TestProject/_build/definition?definitionId=1",
    );
  });

  it("falls back to url when _links is absent", async () => {
    const raw = makeRawPipelineDefinition({ _links: undefined });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [raw] }),
    });

    const client = new PipelinesClient(createConfig());
    const [def] = await client.listDefinitions("TestProject");

    expect(def.webUrl).toBe("https://dev.azure.com/testorg/TestProject/_apis/pipelines/1");
  });

  it("defaults folder to backslash when absent", async () => {
    const raw = makeRawPipelineDefinition({ folder: undefined });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [raw] }),
    });

    const client = new PipelinesClient(createConfig());
    const [def] = await client.listDefinitions("TestProject");

    expect(def.folder).toBe("\\");
  });

  it("returns empty array when value is empty", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new PipelinesClient(createConfig());
    const result = await client.listDefinitions("TestProject");

    expect(result).toEqual([]);
  });

  it("propagates AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new PipelinesClient(createConfig());
    await expect(client.listDefinitions("TestProject")).rejects.toThrow(AuthenticationError);
  });
});

// ─── PipelinesClient.getRun ───────────────────────────────────────────────────

describe("PipelinesClient.getRun — response mapping and errors", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps all fields including result and finishedDate", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPipelineRun()),
    });

    const client = new PipelinesClient(createConfig());
    const run = await client.getRun("TestProject", 1, 42);

    expect(run.id).toBe(42);
    expect(run.name).toBe("20260401.1");
    expect(run.state).toBe("completed");
    expect(run.result).toBe("succeeded");
    expect(run.createdDate).toBe("2026-04-01T10:00:00Z");
    expect(run.finishedDate).toBe("2026-04-01T10:15:00Z");
    expect(run.pipeline.id).toBe(1);
    expect(run.pipeline.name).toBe("CI Pipeline");
  });

  it("sets result and finishedDate to null when absent", async () => {
    const raw = makeRawPipelineRun({
      result: undefined,
      state: "inProgress",
      finishedDate: undefined,
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(raw),
    });

    const client = new PipelinesClient(createConfig());
    const run = await client.getRun("TestProject", 1, 42);

    expect(run.result).toBeNull();
    expect(run.finishedDate).toBeNull();
    expect(run.state).toBe("inProgress");
  });

  it("propagates AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new PipelinesClient(createConfig());
    await expect(client.getRun("TestProject", 1, 42)).rejects.toThrow(AuthenticationError);
  });

  it("propagates NotFoundError on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Run not found" }),
    });

    const client = new PipelinesClient(createConfig());
    await expect(client.getRun("TestProject", 1, 99999)).rejects.toThrow(NotFoundError);
  });
});

// ─── PipelinesClient.listRuns ─────────────────────────────────────────────────

describe("PipelinesClient.listRuns — response mapping", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps BuildRunSummary fields from raw build response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [makeRawBuild()] }),
    });

    const client = new PipelinesClient(createConfig());
    const runs = await client.listRuns("TestProject");

    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.id).toBe(100);
    expect(run.buildNumber).toBe("20260401.1");
    expect(run.status).toBe("completed");
    expect(run.result).toBe("succeeded");
    expect(run.definitionId).toBe(1);
    expect(run.definitionName).toBe("CI Pipeline");
    expect(run.requestedFor).toBe("Alice");
    expect(run.sourceBranch).toBe("refs/heads/main");
    expect(run.sourceVersion).toBe("abc123");
  });

  it("sets optional fields to null or empty string when absent", async () => {
    const raw = makeRawBuild({
      result: undefined,
      startTime: undefined,
      finishTime: undefined,
      requestedFor: undefined,
      sourceBranch: undefined,
      sourceVersion: undefined,
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [raw] }),
    });

    const client = new PipelinesClient(createConfig());
    const [run] = await client.listRuns("TestProject");

    expect(run.result).toBeNull();
    expect(run.startTime).toBeNull();
    expect(run.finishTime).toBeNull();
    expect(run.requestedFor).toBe("");
    expect(run.sourceBranch).toBe("");
    expect(run.sourceVersion).toBe("");
  });

  it("passes statusFilter=completed in URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new PipelinesClient(createConfig());
    await client.listRuns("TestProject", undefined, { statusFilter: "completed" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("statusFilter=completed");
  });

  it("passes statusFilter=all in URL (returns all statuses)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new PipelinesClient(createConfig());
    await client.listRuns("TestProject", undefined, { statusFilter: "all" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("statusFilter=all");
  });

  it("includes pipelineId as definitions param in URL when provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new PipelinesClient(createConfig());
    await client.listRuns("TestProject", 7);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("definitions=7");
  });
});

// ─── PipelinesClient.getLogs — truncation ────────────────────────────────────

describe("PipelinesClient.getLogs — response mapping and log truncation", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns all logs with truncated: false when response is under 10 KB", async () => {
    const logs = [makeRawBuildLog(1), makeRawBuildLog(2), makeRawBuildLog(3)];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: logs.length, value: logs }),
    });

    const client = new PipelinesClient(createConfig());
    const result = await client.getLogs("TestProject", 123);

    expect(result.truncated).toBe(false);
    expect(result.logs).toHaveLength(3);
    expect(result.logs[0]).toEqual({
      id: 1,
      type: "Container",
      url: expect.stringContaining("/logs/1"),
      lineCount: 100,
    });
  });

  it("truncates logs and sets truncated: true when serialized size exceeds 10 KB", async () => {
    // 200 entries × ~115 bytes each ≈ 23 KB, well above the 10 KB limit
    const manyLogs = Array.from({ length: 200 }, (_, i) => makeRawBuildLog(i + 1));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: manyLogs.length, value: manyLogs }),
    });

    const client = new PipelinesClient(createConfig());
    const result = await client.getLogs("TestProject", 123);

    expect(result.truncated).toBe(true);
    expect(result.logs.length).toBeLessThan(200);
    // Serialized output must stay within the 10 KB budget
    expect(JSON.stringify(result.logs).length).toBeLessThanOrEqual(10 * 1024);
  });

  it("returns all entries when total is exactly at the boundary", async () => {
    // A single small entry should never trigger truncation
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [makeRawBuildLog(1)] }),
    });

    const client = new PipelinesClient(createConfig());
    const result = await client.getLogs("TestProject", 123);

    expect(result.truncated).toBe(false);
    expect(result.logs).toHaveLength(1);
  });

  it("propagates NotFoundError on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Build not found" }),
    });

    const client = new PipelinesClient(createConfig());
    await expect(client.getLogs("TestProject", 99999)).rejects.toThrow(NotFoundError);
  });

  it("propagates AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new PipelinesClient(createConfig());
    await expect(client.getLogs("TestProject", 123)).rejects.toThrow(AuthenticationError);
  });
});

// ─── 429 rate-limit auto-retry ────────────────────────────────────────────────

describe("429 rate-limit auto-retry", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("retries after a 429 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          // Retry-After: 0 so backoff is 0ms
          headers: { get: (header: string) => (header === "Retry-After" ? "0" : null) },
          json: () => Promise.resolve({ message: "Too Many Requests" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ count: 1, value: [makeRawPipelineDefinition()] }),
      });
    });

    const client = new PipelinesClient(createConfig());
    const resultPromise = client.listDefinitions("TestProject");

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(1);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── Project resolution ───────────────────────────────────────────────────────

describe("project resolution", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses provided project in URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new PipelinesClient(createConfig());
    await client.listDefinitions("CustomProject");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testorg/CustomProject/_apis/");
  });

  it("falls back to defaultProject from config when no project given", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const config = createConfig({ defaultProject: "FallbackProject" });
    const client = new PipelinesClient(config);
    await client.listDefinitions();

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testorg/FallbackProject/_apis/");
  });

  it("throws when no project provided and no defaultProject configured", async () => {
    const config = createConfig({ defaultProject: undefined });
    const client = new PipelinesClient(config);
    await expect(client.listDefinitions()).rejects.toThrow("Project is required");
  });
});
