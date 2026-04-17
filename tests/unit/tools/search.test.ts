import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SearchClient } from "../../../src/clients/search-client.js";
import type { AdoConfig } from "../../../src/auth/types.js";

function createConfig(): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: { getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0") },
  };
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
      json: () =>
        Promise.resolve({ count: 1, results: [makeRawSearchResult()] }),
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
      json: () =>
        Promise.resolve({ count: 1, results: [makeRawSearchResult()] }),
    });

    const client = new SearchClient(createConfig());
    const result = await client.searchCode("kafka");

    expect(result.results[0].repository.id).toBe("repo-1");
    expect(result.results[0].repository.name).toBe("demo-backend");
  });
});
