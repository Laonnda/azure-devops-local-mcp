import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { registerGitTools } from "../../../src/tools/git.js";
import { GitClient } from "../../../src/clients/git-client.js";

function createConfig(): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: {
      getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0"),
    },
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

  it("listPullRequests returns mapped PRs", async () => {
    const mockResponse = {
      value: [
        {
          pullRequestId: 42,
          title: "Add feature X",
          description: "Implements feature X",
          status: "active",
          createdBy: { displayName: "John Doe" },
          creationDate: "2026-03-27T10:00:00Z",
          sourceRefName: "refs/heads/feature/x",
          targetRefName: "refs/heads/main",
          repository: { id: "repo-1", name: "my-repo" },
          reviewers: [{ displayName: "Jane", vote: 10, isRequired: true }],
          isDraft: false,
          url: "https://dev.azure.com/...",
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
    expect(prs[0].createdBy).toBe("John Doe");
    expect(prs[0].reviewers[0].displayName).toBe("Jane");
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
