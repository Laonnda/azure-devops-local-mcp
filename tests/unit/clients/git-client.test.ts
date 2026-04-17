import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitClient } from "../../../src/clients/git-client.js";
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

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  });
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const rawThread = {
  id: 10,
  status: "active",
  isDeleted: false,
  publishedDate: "2026-04-01T00:00:00Z",
  comments: [
    {
      id: 1,
      content: "looks good",
      author: { displayName: "Alice", id: "u1", uniqueName: "alice@co.com" },
      publishedDate: "2026-04-01T00:00:00Z",
      commentType: "text",
    },
  ],
  threadContext: null,
};

describe("GitClient.createComment — new general thread", () => {
  it("posts to threads endpoint and returns mapped thread", async () => {
    globalThis.fetch = mockFetch(rawThread);
    const client = new GitClient(createConfig());
    const thread = await client.createComment("TestProject", "repo-1", 42, {
      content: "looks good",
    });

    expect(thread.id).toBe(10);
    expect(thread.comments[0].content).toBe("looks good");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/pullrequests/42/threads");
    expect(JSON.parse(call[1].body as string).comments[0].content).toBe("looks good");
  });
});

describe("GitClient.createComment — reply to existing thread", () => {
  it("posts to thread comments endpoint", async () => {
    globalThis.fetch = mockFetch(rawThread);
    const client = new GitClient(createConfig());
    await client.createComment("TestProject", "repo-1", 42, {
      content: "agreed",
      threadId: 10,
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/threads/10/comments");
  });
});

describe("GitClient.createComment — inline comment", () => {
  it("includes rightFileStart/End for right-side inline comment", async () => {
    globalThis.fetch = mockFetch(rawThread);
    const client = new GitClient(createConfig());
    await client.createComment("TestProject", "repo-1", 42, {
      content: "fix this",
      filePath: "/src/foo.ts",
      lineNumber: 10,
    });

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    const ctx = body.threadContext as Record<string, unknown>;
    expect(ctx.filePath).toBe("/src/foo.ts");
    expect(ctx.rightFileStart).toEqual({ line: 10, offset: 1 });
  });

  it("includes leftFileStart/End for left-side inline comment", async () => {
    globalThis.fetch = mockFetch(rawThread);
    const client = new GitClient(createConfig());
    await client.createComment("TestProject", "repo-1", 42, {
      content: "old code",
      filePath: "/src/foo.ts",
      lineNumber: 5,
      side: "left",
    });

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    const ctx = body.threadContext as Record<string, unknown>;
    expect(ctx.leftFileStart).toEqual({ line: 5, offset: 1 });
    expect(ctx).not.toHaveProperty("rightFileStart");
  });
});

describe("GitClient.createComment — comment truncation", () => {
  it("truncates long comment content in thread response", async () => {
    const longContent = "a".repeat(600);
    const rawWithLong = {
      ...rawThread,
      comments: [{ ...rawThread.comments[0], content: longContent }],
    };
    globalThis.fetch = mockFetch(rawWithLong);
    const client = new GitClient(createConfig());
    const thread = await client.createComment("TestProject", "repo-1", 42, {
      content: longContent,
    });
    expect(thread.comments[0].content.length).toBeLessThan(longContent.length);
    expect(thread.comments[0].content).toContain("truncated");
  });
});

describe("GitClient.listPullRequests — empty reviewer list", () => {
  it("handles PRs with no reviewers", async () => {
    globalThis.fetch = mockFetch({
      value: [
        {
          pullRequestId: 1,
          title: "Fix bug",
          status: "active",
          createdBy: { displayName: "Alice", id: "u1", uniqueName: "alice@co.com" },
          creationDate: "2026-04-01T00:00:00Z",
          sourceRefName: "refs/heads/fix",
          targetRefName: "refs/heads/main",
          url: "https://dev.azure.com/_apis/git/pullrequests/1",
          reviewers: [],
        },
      ],
    });
    const client = new GitClient(createConfig());
    const prs = await client.listPullRequests("repo-1", { project: "TestProject" });
    expect(prs[0].reviewers).toEqual([]);
  });
});
