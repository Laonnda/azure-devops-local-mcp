import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SearchClient } from "../../../src/clients/search-client.js";
import { registerSearchTools } from "../../../src/tools/search.js";
import type { AdoConfig } from "../../../src/auth/types.js";

function createConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: { getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0") },
    rateLimiter: new RateLimiter(60),
    ...overrides,
  };
}

type RegisteredTool = {
  inputSchema: { parse: (v: unknown) => Record<string, unknown> };
  handler: (
    v: unknown,
  ) => Promise<{ isError?: boolean; content: { type: string; text: string }[] }>;
};

function getSearchTool(config: AdoConfig = createConfig()): RegisteredTool {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerSearchTools(server, config);
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools["ado_git_search_code"];
}

function makeRawSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "kafka.ts",
    path: "/src/kafka.ts",
    repository: { name: "demo-backend", id: "repo-1" },
    project: { name: "DEMO PROJECT" },
    matches: {
      content: [
        { charOffset: 12, length: 5 },
        { charOffset: 87, length: 5 },
      ],
    },
    ...overrides,
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

describe("SearchClient.searchCode — matches mapping", () => {
  it("matches contains charOffset and length objects, not nulls", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, results: [makeRawSearchResult()] }),
    });

    const client = new SearchClient(createConfig());
    const result = await client.searchCode("kafka");

    expect(result.results[0].matches).toHaveLength(2);
    expect(result.results[0].matches[0]).toEqual({ charOffset: 12, length: 5 });
    expect(result.results[0].matches[1]).toEqual({ charOffset: 87, length: 5 });
  });

  it("returns empty matches array when API returns no content hits", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          count: 1,
          results: [makeRawSearchResult({ matches: { content: [] } })],
        }),
    });

    const client = new SearchClient(createConfig());
    const result = await client.searchCode("kafka");

    expect(result.results[0].matches).toEqual([]);
  });

  it("returns empty matches when matches field is absent", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          count: 1,
          results: [makeRawSearchResult({ matches: undefined })],
        }),
    });

    const client = new SearchClient(createConfig());
    const result = await client.searchCode("kafka");

    expect(result.results[0].matches).toEqual([]);
  });

  it("passes project filter in request body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, results: [] }),
    });

    const client = new SearchClient(createConfig());
    await client.searchCode("kafka", { project: "EMS" });

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect((body.filters as Record<string, string[]>)["Project"]).toEqual(["EMS"]);
  });

  it("routes to almsearch host", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, results: [] }),
    });

    const client = new SearchClient(createConfig());
    await client.searchCode("kafka");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("almsearch.dev.azure.com");
  });

  it("result contains repository id alongside repository name", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, results: [makeRawSearchResult()] }),
    });

    const client = new SearchClient(createConfig());
    const result = await client.searchCode("kafka");

    expect(result.results[0].repository.id).toBe("repo-1");
    expect(result.results[0].repository.name).toBe("demo-backend");
  });
});

describe("Search Tool Registration", () => {
  it("registers the code search tool without error", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerSearchTools(server, createConfig());

    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools["ado_git_search_code"]).toBeDefined();
  });
});

describe("ado_git_search_code — input validation", () => {
  const schema = getSearchTool().inputSchema;

  it("accepts minimal input and applies default top of 25", () => {
    const parsed = schema.parse({ searchText: "kafka" });
    expect(parsed.searchText).toBe("kafka");
    expect(parsed.top).toBe(25);
  });

  it("accepts all optional fields", () => {
    const parsed = schema.parse({
      searchText: "kafka consumer",
      project: "DEMO PROJECT",
      repositoryName: "demo-backend",
      top: 100,
    });
    expect(parsed.project).toBe("DEMO PROJECT");
    expect(parsed.repositoryName).toBe("demo-backend");
    expect(parsed.top).toBe(100);
  });

  it("rejects empty searchText", () => {
    expect(() => schema.parse({ searchText: "" })).toThrow();
  });

  it("rejects searchText longer than 256 characters", () => {
    expect(() => schema.parse({ searchText: "x".repeat(257) })).toThrow();
  });

  it("accepts searchText of exactly 256 characters", () => {
    expect(() => schema.parse({ searchText: "x".repeat(256) })).not.toThrow();
  });

  it("rejects top of 0", () => {
    expect(() => schema.parse({ searchText: "kafka", top: 0 })).toThrow();
  });

  it("rejects top above 100", () => {
    expect(() => schema.parse({ searchText: "kafka", top: 101 })).toThrow();
  });

  it("rejects non-integer top", () => {
    expect(() => schema.parse({ searchText: "kafka", top: 2.5 })).toThrow();
  });

  it("rejects project name with invalid characters", () => {
    expect(() => schema.parse({ searchText: "kafka", project: "EMS;DROP TABLE" })).toThrow();
  });

  it("rejects project name containing path traversal", () => {
    expect(() => schema.parse({ searchText: "kafka", project: "../other-org" })).toThrow();
  });

  it("rejects repositoryName longer than 256 characters", () => {
    expect(() => schema.parse({ searchText: "kafka", repositoryName: "r".repeat(257) })).toThrow();
  });
});

describe("ado_git_search_code — response shaping", () => {
  it("maps API results to file/path/repository/project fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, results: [makeRawSearchResult()] }),
    });

    const result = await getSearchTool().handler({ searchText: "kafka", top: 25 });
    const payload = JSON.parse(result.content[0].text) as {
      totalCount: number;
      showing: number;
      results: Record<string, unknown>[];
    };

    expect(result.isError).toBeUndefined();
    expect(payload.results[0]).toEqual({
      file: "kafka.ts",
      path: "/src/kafka.ts",
      repository: "demo-backend",
      repositoryId: "repo-1",
      project: "DEMO PROJECT",
      matchCount: 2,
      matches: [
        { charOffset: 12, length: 5 },
        { charOffset: 87, length: 5 },
      ],
    });
  });

  it("reports totalCount from API count and showing from returned page size", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          count: 240,
          results: [makeRawSearchResult(), makeRawSearchResult({ fileName: "other.ts" })],
        }),
    });

    const result = await getSearchTool().handler({ searchText: "kafka", top: 2 });
    const payload = JSON.parse(result.content[0].text) as { totalCount: number; showing: number };

    expect(payload.totalCount).toBe(240);
    expect(payload.showing).toBe(2);
  });

  it("caps matches at 5 per file while matchCount reports the real total", async () => {
    const manyHits = Array.from({ length: 8 }, (_, i) => ({ charOffset: i * 10, length: 5 }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          count: 1,
          results: [makeRawSearchResult({ matches: { content: manyHits } })],
        }),
    });

    const result = await getSearchTool().handler({ searchText: "kafka", top: 25 });
    const payload = JSON.parse(result.content[0].text) as {
      results: { matchCount: number; matches: unknown[] }[];
    };

    expect(payload.results[0].matchCount).toBe(8);
    expect(payload.results[0].matches).toHaveLength(5);
  });

  it("returns an empty result set without error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, results: [] }),
    });

    const result = await getSearchTool().handler({ searchText: "nomatches", top: 25 });
    const payload = JSON.parse(result.content[0].text) as {
      totalCount: number;
      showing: number;
      results: unknown[];
    };

    expect(result.isError).toBeUndefined();
    expect(payload).toEqual({ totalCount: 0, showing: 0, results: [] });
  });
});

describe("SearchClient.searchCode — request construction", () => {
  function mockEmptyResponse(): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, results: [] }),
    });
  }

  function lastRequestBody(): Record<string, unknown> {
    return JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
  }

  it("sends POST to the codesearchresults endpoint with api-version", async () => {
    mockEmptyResponse();

    await new SearchClient(createConfig()).searchCode("kafka");

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string },
    ];
    expect(init.method).toBe("POST");
    expect(url).toContain("/_apis/search/codesearchresults");
    expect(url).toContain("api-version=");
  });

  it("passes searchText through in the request body", async () => {
    mockEmptyResponse();

    await new SearchClient(createConfig()).searchCode("kafka consumer group");

    expect(lastRequestBody().searchText).toBe("kafka consumer group");
  });

  it("passes repository filter in request body", async () => {
    mockEmptyResponse();

    await new SearchClient(createConfig()).searchCode("kafka", {
      repositoryName: "demo-backend",
    });

    const filters = lastRequestBody().filters as Record<string, string[]>;
    expect(filters["Repository"]).toEqual(["demo-backend"]);
    expect(filters["Project"]).toBeUndefined();
  });

  it("passes project and repository filters together", async () => {
    mockEmptyResponse();

    await new SearchClient(createConfig()).searchCode("kafka", {
      project: "EMS",
      repositoryName: "ems-api",
    });

    const filters = lastRequestBody().filters as Record<string, string[]>;
    expect(filters["Project"]).toEqual(["EMS"]);
    expect(filters["Repository"]).toEqual(["ems-api"]);
  });

  it("sends empty filters object when no scope options are given", async () => {
    mockEmptyResponse();

    await new SearchClient(createConfig()).searchCode("kafka");

    expect(lastRequestBody().filters).toEqual({});
  });

  it("passes top as $top in the request body", async () => {
    mockEmptyResponse();

    await new SearchClient(createConfig()).searchCode("kafka", { top: 100 });

    expect(lastRequestBody().$top).toBe(100);
  });

  it("defaults $top to 25 when not provided", async () => {
    mockEmptyResponse();

    await new SearchClient(createConfig()).searchCode("kafka");

    expect(lastRequestBody().$top).toBe(25);
  });
});

describe("ado_git_search_code — error handling", () => {
  it("returns isError with sanitized message on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "TF400813: not authorized" }),
    });

    const result = await getSearchTool().handler({ searchText: "kafka", top: 25 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Authentication failed/);
  });

  it("returns isError with resource message on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Project 'Nope' does not exist" }),
    });

    const result = await getSearchTool().handler({ searchText: "kafka", top: 25 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Resource not found: Project 'Nope' does not exist/);
  });

  it("returns isError with API message on 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: "Internal server error" }),
    });

    const result = await getSearchTool().handler({ searchText: "kafka", top: 25 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Internal server error");
  });

  it("returns isError with rate limit message after exhausting 429 retries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === "Retry-After" ? "0" : null) },
      json: () => Promise.resolve({}),
    });

    // High-rate limiter so retry backoff resolves instantly in the test
    const config = createConfig({ rateLimiter: new RateLimiter(60_000) });
    const result = await getSearchTool(config).handler({ searchText: "kafka", top: 25 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Rate limited/);
    // 1 initial attempt + 3 retries
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
  });

  it("returns generic message on unexpected network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("socket hang up"));

    const result = await getSearchTool().handler({ searchText: "kafka", top: 25 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/An unexpected error occurred/);
    expect(result.content[0].text).not.toContain("socket hang up");
  });
});
