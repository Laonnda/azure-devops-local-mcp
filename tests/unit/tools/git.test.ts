import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { registerGitTools } from "../../../src/tools/git.js";
import { GitClient } from "../../../src/clients/git-client.js";
import { guidSchema } from "../../../src/validation/common.js";

function createConfig(): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: {
      getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0"),
    },
    rateLimiter: new RateLimiter(60),
  };
}

describe("Git Tool Registration", () => {
  it("registers all 5 git tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const config = createConfig();

    registerGitTools(server, config);
    expect(server).toBeDefined();
  });
});

describe("GitClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("listRepositories returns mapped repos", async () => {
    const mockResponse = {
      value: [
        {
          id: "repo-1",
          name: "my-repo",
          defaultBranch: "refs/heads/main",
          size: 1024,
          webUrl: "https://dev.azure.com/testorg/TestProject/_git/my-repo",
          project: { id: "proj-1", name: "TestProject" },
        },
      ],
      count: 1,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const client = new GitClient(createConfig());
    const repos = await client.listRepositories("TestProject");

    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("my-repo");
    expect(repos[0].id).toBe("repo-1");
    expect(repos[0].defaultBranch).toBe("refs/heads/main");
  });

  it("listPullRequests webUrl falls back to url when _links absent", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          value: [
            {
              pullRequestId: 7,
              title: "T",
              description: "",
              status: "active",
              createdBy: { displayName: "Dev" },
              creationDate: "2026-01-01T00:00:00Z",
              sourceRefName: "refs/heads/feat",
              targetRefName: "refs/heads/main",
              repository: { id: "r1", name: "repo" },
              reviewers: [],
              isDraft: false,
              url: "https://dev.azure.com/api/pr/7",
            },
          ],
          count: 1,
        }),
    });

    const client = new GitClient(createConfig());
    const prs = await client.listPullRequests("TestProject");

    expect(prs[0].webUrl).toBe("https://dev.azure.com/api/pr/7");
  });

  it("listPullRequests with status='all' sends searchCriteria.status=all to the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ value: [], count: 0 }),
    });

    const client = new GitClient(createConfig());
    await client.listPullRequests("TestProject", { status: "all" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("searchCriteria.status=all");
  });

  it("listPullRequests with status='active' sends correct status param", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ value: [], count: 0 }),
    });

    const client = new GitClient(createConfig());
    await client.listPullRequests("TestProject", { status: "active" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("searchCriteria.status=active");
  });

  it("listPullRequests returns mapped PRs with id and uniqueName", async () => {
    const mockResponse = {
      value: [
        {
          pullRequestId: 42,
          title: "Add feature X",
          description: "Implements feature X",
          status: "active",
          createdBy: {
            displayName: "John Doe",
            id: "aaaa-0001",
            uniqueName: "john.doe@example.com",
          },
          creationDate: "2026-03-27T10:00:00Z",
          sourceRefName: "refs/heads/feature/x",
          targetRefName: "refs/heads/main",
          repository: { id: "repo-1", name: "my-repo" },
          reviewers: [
            {
              displayName: "Jane",
              id: "bbbb-0002",
              uniqueName: "jane@example.com",
              vote: 10,
              isRequired: true,
            },
          ],
          isDraft: false,
          url: "https://dev.azure.com/api/pr/42",
          _links: {
            web: { href: "https://dev.azure.com/TestProject/_git/my-repo/pullrequest/42" },
          },
        },
      ],
      count: 1,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const client = new GitClient(createConfig());
    const prs = await client.listPullRequests("TestProject");

    expect(prs).toHaveLength(1);
    expect(prs[0].pullRequestId).toBe(42);
    expect(prs[0].title).toBe("Add feature X");
    expect(prs[0].createdBy.displayName).toBe("John Doe");
    expect(prs[0].createdBy.id).toBe("aaaa-0001");
    expect(prs[0].createdBy.uniqueName).toBe("john.doe@example.com");
    expect(prs[0].reviewers[0].displayName).toBe("Jane");
    expect(prs[0].reviewers[0].id).toBe("bbbb-0002");
    expect(prs[0].reviewers[0].uniqueName).toBe("jane@example.com");
    expect(prs[0].webUrl).toBe("https://dev.azure.com/TestProject/_git/my-repo/pullrequest/42");
  });

  it("listPullRequests falls back to empty strings when id/uniqueName absent", async () => {
    const mockResponse = {
      value: [
        {
          pullRequestId: 1,
          title: "T",
          description: "",
          status: "active",
          createdBy: { displayName: "Old API" },
          creationDate: "2026-01-01T00:00:00Z",
          sourceRefName: "refs/heads/feat",
          targetRefName: "refs/heads/main",
          repository: { id: "r1", name: "repo" },
          reviewers: [{ displayName: "Rev", vote: 0, isRequired: false }],
          isDraft: false,
          url: "https://dev.azure.com/api/...",
          _links: { web: { href: "https://dev.azure.com/web/..." } },
        },
      ],
      count: 1,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const client = new GitClient(createConfig());
    const prs = await client.listPullRequests("TestProject");

    expect(prs[0].createdBy.displayName).toBe("Old API");
    expect(prs[0].createdBy.id).toBe("");
    expect(prs[0].createdBy.uniqueName).toBe("");
    expect(prs[0].reviewers[0].id).toBe("");
    expect(prs[0].reviewers[0].uniqueName).toBe("");
    expect(prs[0].webUrl).toBe("https://dev.azure.com/web/...");
  });

  describe("createComment", () => {
    const threadResponse = {
      id: 10,
      status: "active",
      comments: [
        {
          id: 101,
          content: "First comment",
          author: { displayName: "Alice" },
          publishedDate: "2026-04-07T12:00:00Z",
          commentType: "text",
        },
        {
          id: 102,
          content: "Reply comment",
          author: { displayName: "Bob" },
          publishedDate: "2026-04-07T13:00:00Z",
          commentType: "text",
        },
      ],
      threadContext: undefined,
      isDeleted: false,
      publishedDate: "2026-04-07T12:00:00Z",
    };

    it("reply to thread returns correct comment ID (not thread ID)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(threadResponse),
      });

      const client = new GitClient(createConfig());
      const result = await client.createComment("TestProject", "repo-1", 42, {
        content: "Reply comment",
        threadId: 10,
      });

      expect(result.id).toBe(10);
      expect(result.comments[1].id).toBe(102);
      expect(result.comments[1].id).not.toBe(result.id);
    });

    it("reply to thread returns author from API response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(threadResponse),
      });

      const client = new GitClient(createConfig());
      const result = await client.createComment("TestProject", "repo-1", 42, {
        content: "Reply comment",
        threadId: 10,
      });

      expect(result.comments[1].author).toBe("Bob");
    });

    it("reply to thread returns timestamps from API response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(threadResponse),
      });

      const client = new GitClient(createConfig());
      const result = await client.createComment("TestProject", "repo-1", 42, {
        content: "Reply comment",
        threadId: 10,
      });

      expect(result.publishedDate).toBe("2026-04-07T12:00:00Z");
      expect(result.comments[1].publishedDate).toBe("2026-04-07T13:00:00Z");
    });

    it("reply to thread returns actual thread status", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(threadResponse),
      });

      const client = new GitClient(createConfig());
      const result = await client.createComment("TestProject", "repo-1", 42, {
        content: "Reply comment",
        threadId: 10,
      });

      expect(result.status).toBe("active");
    });

    it("create new thread returns mapped thread", async () => {
      const newThreadResponse = {
        id: 20,
        status: "active",
        comments: [
          {
            id: 201,
            content: "New thread comment",
            author: { displayName: "Charlie" },
            publishedDate: "2026-04-07T14:00:00Z",
            commentType: "text",
          },
        ],
        threadContext: { filePath: "/src/foo.ts" },
        isDeleted: false,
        publishedDate: "2026-04-07T14:00:00Z",
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(newThreadResponse),
      });

      const client = new GitClient(createConfig());
      const result = await client.createComment("TestProject", "repo-1", 42, {
        content: "New thread comment",
      });

      expect(result.id).toBe(20);
      expect(result.status).toBe("active");
      expect(result.comments[0].id).toBe(201);
      expect(result.comments[0].author).toBe("Charlie");
      expect(result.threadContext?.filePath).toBe("/src/foo.ts");
    });
  });

  it("getPullRequestThreads filters correctly", async () => {
    const mockResponse = {
      value: [
        {
          id: 1,
          status: "active",
          comments: [
            {
              id: 1,
              content: "Looks good",
              author: { displayName: "Reviewer" },
              publishedDate: "2026-03-27T10:00:00Z",
              commentType: "text",
            },
          ],
          threadContext: {
            filePath: "/src/index.ts",
            rightFileStart: { line: 10 },
            rightFileEnd: { line: 10 },
          },
          isDeleted: false,
          publishedDate: "2026-03-27T10:00:00Z",
        },
      ],
      count: 1,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const client = new GitClient(createConfig());
    const threads = await client.getPullRequestThreads("TestProject", "repo-1", 42);

    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].content).toBe("Looks good");
    expect(threads[0].threadContext?.filePath).toBe("/src/index.ts");
  });
});

describe("GitClient.createComment — MED-4 schema improvements", () => {
  let originalFetch: typeof globalThis.fetch;

  const emptyThread = {
    id: 5,
    status: "active",
    comments: [
      {
        id: 50,
        content: "test",
        author: { displayName: "Dev" },
        publishedDate: "2026-04-17T00:00:00Z",
        commentType: "text",
      },
    ],
    threadContext: undefined,
    isDeleted: false,
    publishedDate: "2026-04-17T00:00:00Z",
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(emptyThread),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends rightFileStart/rightFileEnd for right-side single-line comment", async () => {
    const client = new GitClient(createConfig());
    await client.createComment("TestProject", "repo-1", 1, {
      content: "looks good",
      filePath: "/src/foo.ts",
      lineNumber: 10,
    });

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    const ctx = body.threadContext as Record<string, unknown>;
    expect(ctx.filePath).toBe("/src/foo.ts");
    expect(ctx.rightFileStart).toEqual({ line: 10, offset: 1 });
    expect(ctx.rightFileEnd).toEqual({ line: 10, offset: 1 });
    expect(ctx.leftFileStart).toBeUndefined();
  });

  it("sends leftFileStart/leftFileEnd for left-side comment", async () => {
    const client = new GitClient(createConfig());
    await client.createComment("TestProject", "repo-1", 1, {
      content: "old code issue",
      filePath: "/src/foo.ts",
      lineNumber: 5,
      side: "left",
    });

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    const ctx = body.threadContext as Record<string, unknown>;
    expect(ctx.leftFileStart).toEqual({ line: 5, offset: 1 });
    expect(ctx.leftFileEnd).toEqual({ line: 5, offset: 1 });
    expect(ctx.rightFileStart).toBeUndefined();
  });

  it("sends start and end for a multi-line range", async () => {
    const client = new GitClient(createConfig());
    await client.createComment("TestProject", "repo-1", 1, {
      content: "this block",
      filePath: "/src/foo.ts",
      lineNumber: 10,
      endLineNumber: 20,
    });

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    const ctx = body.threadContext as Record<string, unknown>;
    expect(ctx.rightFileStart).toEqual({ line: 10, offset: 1 });
    expect(ctx.rightFileEnd).toEqual({ line: 20, offset: 1 });
  });
});

describe("ado_git_create_pr_comment tool — mutual exclusion (MED-4)", () => {
  it("rejects when both threadId and filePath are provided", async () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const config = createConfig();
    registerGitTools(server, config);

    const tool = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            inputSchema: { parse: (v: unknown) => unknown };
            handler: (v: unknown) => Promise<unknown>;
          }
        >;
      }
    )._registeredTools["ado_git_create_pr_comment"];

    const result = (await tool.handler({
      project: "TestProject",
      repositoryId: "repo-1",
      pullRequestId: 1,
      content: "hi",
      threadId: 5,
      filePath: "/src/foo.ts",
      side: "right",
    })) as { isError: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/mutually exclusive/);
  });
});

describe("guidSchema (MED-3 — creatorId GUID validation)", () => {
  it("accepts a valid lowercase GUID", () => {
    expect(() => guidSchema.parse("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).not.toThrow();
  });

  it("accepts a valid uppercase GUID", () => {
    expect(() => guidSchema.parse("A1B2C3D4-E5F6-7890-ABCD-EF1234567890")).not.toThrow();
  });

  it("accepts an all-zeros GUID", () => {
    expect(() => guidSchema.parse("00000000-0000-0000-0000-000000000000")).not.toThrow();
  });

  it("rejects a plain string (no hyphens)", () => {
    expect(() => guidSchema.parse("notAGuid")).toThrow();
  });

  it("rejects a GUID with wrong segment lengths", () => {
    expect(() => guidSchema.parse("a1b2c3d4-e5f6-7890-abcd-ef123456789")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => guidSchema.parse("")).toThrow();
  });

  it("rejects a string with invalid hex characters", () => {
    expect(() => guidSchema.parse("g1b2c3d4-e5f6-7890-abcd-ef1234567890")).toThrow();
  });
});
