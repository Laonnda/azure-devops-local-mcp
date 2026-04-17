import { describe, it, expect } from "vitest";
import { HAS_PAT, createIntegrationConfig } from "./setup.js";
import { GitClient } from "../../src/clients/git-client.js";

describe.skipIf(!HAS_PAT)("GitClient — integration", () => {
  const project = process.env.ADO_TEST_PROJECT ?? "";

  it("lists repositories", async () => {
    const client = new GitClient(createIntegrationConfig());
    const repos = await client.listRepositories(project);
    expect(Array.isArray(repos)).toBe(true);
    if (repos.length > 0) {
      expect(repos[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
      });
    }
  });

  it("lists pull requests without error", async () => {
    const client = new GitClient(createIntegrationConfig());
    const repos = await client.listRepositories(project);
    if (repos.length === 0) return;
    const prs = await client.listPullRequests(repos[0].id, {
      project,
      status: "all",
      top: 5,
    });
    expect(Array.isArray(prs)).toBe(true);
  });
});
