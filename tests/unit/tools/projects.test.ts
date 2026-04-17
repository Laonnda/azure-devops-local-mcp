import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { registerProjectsTools } from "../../../src/tools/projects.js";
import { ProjectsClient } from "../../../src/clients/projects-client.js";

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

describe("Projects Tool Registration", () => {
  it("registers the projects list tool without error", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const config = createConfig();

    registerProjectsTools(server, config);
    expect(server).toBeDefined();
  });
});

describe("ProjectsClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists projects with correct mapping", async () => {
    const mockResponse = {
      value: [
        {
          id: "proj-1",
          name: "Project Alpha",
          description: "First project",
          state: "wellFormed",
          url: "https://dev.azure.com/testorg/_apis/projects/proj-1",
          lastUpdateTime: "2026-03-20T10:00:00Z",
        },
        {
          id: "proj-2",
          name: "Project Beta",
          description: "",
          state: "wellFormed",
          url: "https://dev.azure.com/testorg/_apis/projects/proj-2",
          lastUpdateTime: "2026-03-25T10:00:00Z",
        },
      ],
      count: 2,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const client = new ProjectsClient(createConfig());
    const result = await client.list({ top: 10 });

    expect(result.count).toBe(2);
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].name).toBe("Project Alpha");
    expect(result.projects[1].description).toBe("");
  });

  it("constructs URL without project scope", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ value: [], count: 0 }),
    });

    const client = new ProjectsClient(createConfig());
    await client.list();

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Projects endpoint should NOT have a project in the path
    expect(calledUrl).toContain("https://dev.azure.com/testorg/_apis/projects");
    expect(calledUrl).not.toContain("TestProject/_apis/projects");
  });
});
