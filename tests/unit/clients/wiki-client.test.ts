import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WikiClient } from "../../../src/clients/wiki-client.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { AuthenticationError, NotFoundError } from "../../../src/utils/errors.js";

function createConfig(): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: {
      getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0"),
    },
  };
}

function makeRawPage(overrides: Record<string, unknown> = {}) {
  return {
    path: "/MyPage",
    url: "https://dev.azure.com/testorg/TestProject/_wiki/wikis/my-wiki/1/MyPage",
    content: "# Hello",
    lastUpdatedDate: "2026-04-01T10:00:00Z",
    version: 3,
    ...overrides,
  };
}

describe("WikiClient.getPage", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("constructs URL with encoded wikiId and correct query params", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.getPage("TestProject", "my wiki", "/MyPage");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("wiki/wikis/my%20wiki/pages");
    expect(calledUrl).toContain("path=%2FMyPage");
    expect(calledUrl).toContain("includeContent=true");
  });

  it("includes project in URL path", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.getPage("MyProject", "wiki-id", "/Page");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testorg/MyProject/_apis/");
  });

  it("maps response fields correctly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          makeRawPage({
            path: "/Docs/Setup",
            content: "## Setup Guide",
            lastUpdatedDate: "2026-03-15T08:00:00Z",
            version: 7,
          }),
        ),
    });

    const client = new WikiClient(createConfig());
    const page = await client.getPage("TestProject", "wiki-id", "/Docs/Setup");

    expect(page.path).toBe("/Docs/Setup");
    expect(page.content).toBe("## Setup Guide");
    expect(page.lastUpdatedDate).toBe("2026-03-15T08:00:00Z");
    expect(page.version).toBe(7);
  });

  it("defaults content to empty string when missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage({ content: undefined })),
    });

    const client = new WikiClient(createConfig());
    const page = await client.getPage("TestProject", "wiki-id", "/Page");

    expect(page.content).toBe("");
  });

  it("defaults lastUpdatedDate to empty string when missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage({ lastUpdatedDate: undefined })),
    });

    const client = new WikiClient(createConfig());
    const page = await client.getPage("TestProject", "wiki-id", "/Page");

    expect(page.lastUpdatedDate).toBe("");
  });

  it("defaults version to 0 when missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage({ version: undefined })),
    });

    const client = new WikiClient(createConfig());
    const page = await client.getPage("TestProject", "wiki-id", "/Page");

    expect(page.version).toBe(0);
  });

  it("throws AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new WikiClient(createConfig());
    await expect(client.getPage("TestProject", "wiki-id", "/Page")).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("throws NotFoundError on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Wiki page not found" }),
    });

    const client = new WikiClient(createConfig());
    await expect(client.getPage("TestProject", "wiki-id", "/Missing")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws on 500 server error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: "Internal Server Error" }),
    });

    const client = new WikiClient(createConfig());
    await expect(client.getPage("TestProject", "wiki-id", "/Page")).rejects.toThrow();
  });

  it("encodes special characters in wikiId", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.getPage("TestProject", "my wiki/v2", "/Page");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("my%20wiki%2Fv2");
  });
});

describe("WikiClient.listPages", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeListResponse(pages = [makeRawPage()]) {
    return { value: pages, count: pages.length };
  }

  it("constructs URL with encoded wikiId", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeListResponse()),
    });

    const client = new WikiClient(createConfig());
    await client.listPages("TestProject", "my-wiki");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("wiki/wikis/my-wiki/pages");
  });

  it("appends $top and $skip when provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeListResponse()),
    });

    const client = new WikiClient(createConfig());
    await client.listPages("TestProject", "my-wiki", { top: 10, skip: 20 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("%24top=10");
    expect(calledUrl).toContain("%24skip=20");
  });

  it("omits pagination params when not provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeListResponse()),
    });

    const client = new WikiClient(createConfig());
    await client.listPages("TestProject", "my-wiki");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("top");
    expect(calledUrl).not.toContain("skip");
  });

  it("returns mapped pages and count", async () => {
    const rawPages = [
      makeRawPage({ path: "/Page1", content: "Content 1" }),
      makeRawPage({ path: "/Page2", content: "Content 2" }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeListResponse(rawPages)),
    });

    const client = new WikiClient(createConfig());
    const result = await client.listPages("TestProject", "my-wiki");

    expect(result.count).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].path).toBe("/Page1");
    expect(result.pages[1].path).toBe("/Page2");
  });

  it("returns empty pages array when wiki has no pages", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ value: [], count: 0 }),
    });

    const client = new WikiClient(createConfig());
    const result = await client.listPages("TestProject", "my-wiki");

    expect(result.pages).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  it("throws AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new WikiClient(createConfig());
    await expect(client.listPages("TestProject", "my-wiki")).rejects.toThrow(AuthenticationError);
  });

  it("throws NotFoundError on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Wiki not found" }),
    });

    const client = new WikiClient(createConfig());
    await expect(client.listPages("TestProject", "missing-wiki")).rejects.toThrow(NotFoundError);
  });

  it("throws on 500 server error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: "Internal Server Error" }),
    });

    const client = new WikiClient(createConfig());
    await expect(client.listPages("TestProject", "my-wiki")).rejects.toThrow();
  });
});

describe("WikiClient.updatePage", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses PUT method", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.updatePage("TestProject", "my-wiki", "/Page", "# Content");

    const calledOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(calledOptions.method).toBe("PUT");
  });

  it("sends content in request body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.updatePage("TestProject", "my-wiki", "/Page", "# New Content");

    const calledOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(calledOptions.body as string) as Record<string, unknown>;
    expect(body.content).toBe("# New Content");
  });

  it("includes gitVersionDescriptor with commit message when message is provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.updatePage("TestProject", "my-wiki", "/Page", "# Content", "Update docs");

    const calledOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(calledOptions.body as string) as Record<string, unknown>;
    expect(body.gitVersionDescriptor).toEqual({ commitMessage: "Update docs" });
  });

  it("omits gitVersionDescriptor when message is not provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.updatePage("TestProject", "my-wiki", "/Page", "# Content");

    const calledOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(calledOptions.body as string) as Record<string, unknown>;
    expect(body.gitVersionDescriptor).toBeUndefined();
  });

  it("includes path in query string", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPage()),
    });

    const client = new WikiClient(createConfig());
    await client.updatePage("TestProject", "my-wiki", "/MyPage", "# Content");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("path=%2FMyPage");
  });

  it("returns mapped page on success", async () => {
    const rawPage = makeRawPage({ path: "/MyPage", content: "# Updated", version: 5 });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(rawPage),
    });

    const client = new WikiClient(createConfig());
    const page = await client.updatePage("TestProject", "my-wiki", "/MyPage", "# Updated");

    expect(page.path).toBe("/MyPage");
    expect(page.content).toBe("# Updated");
    expect(page.version).toBe(5);
  });

  it("throws AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new WikiClient(createConfig());
    await expect(
      client.updatePage("TestProject", "my-wiki", "/Page", "# Content"),
    ).rejects.toThrow(AuthenticationError);
  });

  it("throws NotFoundError on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Wiki not found" }),
    });

    const client = new WikiClient(createConfig());
    await expect(
      client.updatePage("TestProject", "missing-wiki", "/Page", "# Content"),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws on 500 server error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: "Internal Server Error" }),
    });

    const client = new WikiClient(createConfig());
    await expect(
      client.updatePage("TestProject", "my-wiki", "/Page", "# Content"),
    ).rejects.toThrow();
  });

  it("retries on 429 and succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "1" }),
          json: () => Promise.resolve({ message: "Rate limited" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeRawPage()),
      });
    });

    const client = new WikiClient(createConfig());
    const page = await client.updatePage("TestProject", "my-wiki", "/Page", "# Content");

    expect(callCount).toBe(2);
    expect(page.path).toBe("/MyPage");
  });
});
