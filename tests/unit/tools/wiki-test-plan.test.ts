/**
 * 1:1 vitest port of WIKI_TOOLS_TEST_PLAN.md, cases 1–15.
 * Source of truth is the plan doc — do not modify cases here without
 * adding a row there first.
 *
 * Ported from test_wiki_tools.py (Python/pytest reference implementation).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WikiClient } from "../../../src/clients/wiki-client.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { ValidationError, AuthenticationError, NotFoundError } from "../../../src/utils/errors.js";
import { logger } from "../../../src/utils/logger.js";
import { projectNameSchema } from "../../../src/validation/common.js";

// ---------- Helpers -----------------------------------------------------------

function createConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: { getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0") },
    ...overrides,
  };
}

/** Build a WikiV2-shaped raw API entry — mirrors Python _wiki() builder. */
function _wiki(
  id: string,
  name: string,
  type: "projectWiki" | "codeWiki" = "projectWiki",
  projectId = "p-1",
) {
  return {
    id,
    name,
    type,
    projectId,
    repositoryId: `repo-${id}`,
    mappedPath: type === "projectWiki" ? "/" : "/docs",
    remoteUrl: `https://dev.azure.com/org/proj/_wiki/wikis/${id}`,
    url: `https://dev.azure.com/org/proj/_apis/wiki/wikis/${id}`,
    versions: [{ version: "wikiMaster" }],
    isDisabled: false,
    properties: {},
  };
}

/** Mirrors Python _wikis_response() builder. */
function _wikisResponse(...wikis: ReturnType<typeof _wiki>[]) {
  return { value: wikis, count: wikis.length };
}

function mockFetchOnce(body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function mockFetchSequence(...bodies: unknown[]) {
  const mocks = bodies.map((body) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }),
  );
  globalThis.fetch = vi.fn();
  for (const m of mocks) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(m);
  }
}

function mockFetchError(status: number, message: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ message }),
  });
}

function calledUrl(callIndex = 0): string {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[callIndex][0] as string;
}

function calledBody(callIndex = 0): Record<string, unknown> {
  const options = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[
    callIndex
  ][1] as RequestInit;
  return JSON.parse(options.body as string) as Record<string, unknown>;
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
// ado_wiki_list — cases 1–8
// =============================================================================

describe("ado_wiki_list — case 1: project with one projectWiki", () => {
  it("returns count 1, correct name and type", async () => {
    mockFetchOnce(_wikisResponse(_wiki("w-1", "MainWiki")));
    const client = new WikiClient(createConfig());
    const result = await client.listWikis("DEMO PROJECT");

    expect(result.count).toBe(1);
    expect(result.wikis).toHaveLength(1);
    expect(result.wikis[0].name).toBe("MainWiki");
    expect(result.wikis[0].type).toBe("projectWiki");
  });
});

describe("ado_wiki_list — case 2: mixed projectWiki + codeWiki", () => {
  it("returns both entries with types preserved", async () => {
    mockFetchOnce(
      _wikisResponse(_wiki("w-1", "MainWiki", "projectWiki"), _wiki("w-2", "DevDocs", "codeWiki")),
    );
    const client = new WikiClient(createConfig());
    const result = await client.listWikis("DEMO PROJECT");

    const types = new Set(result.wikis.map((w) => w.type));
    expect(types).toEqual(new Set(["projectWiki", "codeWiki"]));
    expect(result.count).toBe(2);
  });
});

describe("ado_wiki_list — case 3: no wikis provisioned", () => {
  it("returns empty list, not an error", async () => {
    mockFetchOnce(_wikisResponse());
    const client = new WikiClient(createConfig());
    const result = await client.listWikis("EmptyProject");

    expect(result).toEqual({ count: 0, wikis: [] });
  });
});

describe("ado_wiki_list — case 4: org-scope when project omitted", () => {
  it("calls org-level endpoint (no project segment in URL)", async () => {
    mockFetchOnce(
      _wikisResponse(
        _wiki("w-1", "A", "projectWiki", "p-1"),
        _wiki("w-2", "B", "projectWiki", "p-2"),
      ),
    );
    const client = new WikiClient(createConfig());
    const result = await client.listWikis(); // no project

    expect(calledUrl()).toMatch(/testorg\/_apis\/wiki\/wikis/);
    expect(result.count).toBe(2);
  });
});

describe("ado_wiki_list — case 5: response field filtering", () => {
  it("strips verbose fields (url, properties, isDisabled, mappedPath, repositoryId)", async () => {
    mockFetchOnce(_wikisResponse(_wiki("w-1", "MainWiki")));
    const client = new WikiClient(createConfig());
    const result = await client.listWikis("DEMO PROJECT");

    const allowed = new Set(["id", "name", "type", "projectId", "remoteUrl", "versions"]);
    const actual = new Set(Object.keys(result.wikis[0]));
    const extra = [...actual].filter((k) => !allowed.has(k));
    expect(extra).toEqual([]);
  });
});

describe("ado_wiki_list — case 6: non-existent project surfaces 404", () => {
  it("throws NotFoundError (status 404)", async () => {
    mockFetchError(404, "Project not found");
    const client = new WikiClient(createConfig());
    await expect(client.listWikis("DoesNotExist")).rejects.toThrow(NotFoundError);
  });
});

describe("ado_wiki_list — case 7: missing PAT scope surfaces 401/403", () => {
  it("throws AuthenticationError on 401", async () => {
    mockFetchError(401, "Unauthorized");
    const client = new WikiClient(createConfig());
    await expect(client.listWikis("DEMO PROJECT")).rejects.toThrow(AuthenticationError);
  });
});

describe("ado_wiki_list — case 8: invalid project rejected by schema before HTTP", () => {
  it.each(["", "has/slash", "has\\back", "has;semi"])(
    "rejects %j without making an HTTP call",
    (badProject) => {
      globalThis.fetch = vi.fn();
      expect(() => projectNameSchema.parse(badProject)).toThrow();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
});

// =============================================================================
// ado_wiki_list_pages auto-resolve — cases 9–15
// =============================================================================

describe("ado_wiki_list_pages — case 9: explicit wikiId used directly", () => {
  it("makes exactly one HTTP call and URL contains the explicit wikiId", async () => {
    mockFetchOnce({ value: [{ path: "/Home" }], count: 1 });
    const client = new WikiClient(createConfig());
    await client.listPages("DEMO PROJECT", "explicit-wiki-id");

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(calledUrl()).toContain("explicit-wiki-id");
  });
});

describe("ado_wiki_list_pages — case 10: wikiId omitted, auto-resolves projectWiki", () => {
  it("calls wikis-list first then pages with the projectWiki id", async () => {
    mockFetchSequence(
      _wikisResponse(
        _wiki("code-w", "DevDocs", "codeWiki"),
        _wiki("proj-w", "MainWiki", "projectWiki"),
      ),
      { value: [{ path: "/Home" }], count: 1 },
    );
    const client = new WikiClient(createConfig());
    const resolvedId = await client.resolveProjectWikiId("DEMO PROJECT");
    await client.listPages("DEMO PROJECT", resolvedId);

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    const pagesUrl = calledUrl(1);
    expect(pagesUrl).toContain("proj-w");
    expect(pagesUrl).not.toContain("code-w");
  });
});

describe("ado_wiki_list_pages — case 11: only codeWikis exist", () => {
  it("throws ValidationError listing available wiki names", async () => {
    mockFetchOnce(
      _wikisResponse(
        _wiki("code-1", "DevDocs", "codeWiki"),
        _wiki("code-2", "ArchDocs", "codeWiki"),
      ),
    );
    const client = new WikiClient(createConfig());
    const err = await client.resolveProjectWikiId("DEMO PROJECT").catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/DevDocs|ArchDocs|codeWiki/i);
  });
});

describe("ado_wiki_list_pages — case 12: no wikis at all", () => {
  it("throws ValidationError mentioning the project name", async () => {
    mockFetchOnce(_wikisResponse());
    const client = new WikiClient(createConfig());
    const err = await client.resolveProjectWikiId("EmptyProject").catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message.toLowerCase()).toMatch(/no wiki|not provisioned/);
    expect(err.message).toContain("EmptyProject");
  });
});

describe("ado_wiki_list_pages — case 13: multiple projectWikis", () => {
  it("uses first projectWiki and emits a warn log", async () => {
    mockFetchSequence(
      _wikisResponse(
        _wiki("proj-a", "FirstWiki", "projectWiki"),
        _wiki("proj-b", "SecondWiki", "projectWiki"),
      ),
      { value: [], count: 0 },
    );
    const warnSpy = vi.spyOn(logger, "warn");
    const client = new WikiClient(createConfig());

    const resolvedId = await client.resolveProjectWikiId("WeirdProject");
    await client.listPages("WeirdProject", resolvedId);

    expect(calledUrl(1)).toContain("proj-a");
    expect(calledUrl(1)).not.toContain("proj-b");
    const warnMessages = warnSpy.mock.calls.map(([msg]) => msg.toLowerCase());
    expect(warnMessages.some((m) => m.includes("multiple") || m.includes("projectwiki"))).toBe(
      true,
    );
  });
});

describe("ado_wiki_list_pages — case 14: wikiId and project both omitted", () => {
  it("throws ValidationError mentioning 'project' without making HTTP calls", async () => {
    globalThis.fetch = vi.fn();
    const client = new WikiClient(createConfig({ defaultProject: undefined }));

    await expect(client.resolveProjectWikiId("")).rejects.toThrow(ValidationError);
    await expect(client.resolveProjectWikiId("")).rejects.toThrow(/project/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("ado_wiki_list_pages — case 15: pagination forwarded to pagesbatch body only", () => {
  it("top/continuationToken go in pagesbatch body; wikis-list URL has no pagination params", async () => {
    mockFetchSequence(_wikisResponse(_wiki("proj-w", "MainWiki", "projectWiki")), { value: [] });
    const client = new WikiClient(createConfig());
    const resolvedId = await client.resolveProjectWikiId("DEMO PROJECT");
    await client.listPages("DEMO PROJECT", resolvedId, { top: 10, continuationToken: "tok-abc" });

    const wikisUrl = calledUrl(0);
    expect(wikisUrl).not.toMatch(/[Tt]op|[Ss]kip|continuation/i);

    const pagesUrl = calledUrl(1);
    expect(pagesUrl).toContain("pagesbatch");

    const body = calledBody(1);
    expect(body.top).toBe(10);
    expect(body.continuationToken).toBe("tok-abc");
  });
});
