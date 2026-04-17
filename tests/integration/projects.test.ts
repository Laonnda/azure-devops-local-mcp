import { describe, it, expect } from "vitest";
import { HAS_PAT, createIntegrationConfig } from "./setup.js";
import { ProjectsClient } from "../../src/clients/projects-client.js";

describe.skipIf(!HAS_PAT)("ProjectsClient — integration", () => {
  it("lists projects and returns at least one", async () => {
    const client = new ProjectsClient(createIntegrationConfig());
    const result = await client.listProjects();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      url: expect.any(String),
    });
  });
});
