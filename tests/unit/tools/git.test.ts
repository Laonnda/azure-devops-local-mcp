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
