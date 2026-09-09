import { describe, it, expect, afterAll } from "vitest";
import { HAS_PAT, createIntegrationConfig } from "./setup.js";
import { WorkItemsClient } from "../../src/clients/work-items-client.js";

const createdIds: number[] = [];

describe.skipIf(!HAS_PAT)("WorkItemsClient — integration", () => {
  const project = process.env.ADO_TEST_PROJECT ?? "";

  it("queries work items and returns results", async () => {
    const client = new WorkItemsClient(createIntegrationConfig());
    const result = await client.query(
      "SELECT [System.Id], [System.Title] FROM WorkItems ORDER BY [System.ChangedDate] DESC",
      { project, top: 5 },
    );
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.totalCount).toBe("number");
  });

  it("creates a work item and reads it back", async () => {
    const client = new WorkItemsClient(createIntegrationConfig());
    const item = await client.create(project, "Task", {
      "System.Title": "[azure-devops-local-mcp integration test] temporary item — safe to delete",
    });
    expect(item.id).toBeGreaterThan(0);
    expect(item.title).toContain("integration test");
    createdIds.push(item.id);

    const fetched = await client.get(item.id, { project });
    expect(fetched.id).toBe(item.id);
  });

  afterAll(async () => {
    if (createdIds.length === 0) return;
    const client = new WorkItemsClient(createIntegrationConfig());
    for (const id of createdIds) {
      await client.update(id, { "System.State": "Removed" }, { project }).catch(() => {});
    }
  });
});
