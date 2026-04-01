/**
 * MCP tool registrations for Azure DevOps Work Item Tracking.
 * PAT scope: vso.work (read), vso.work_write (create/update)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AdoConfig } from "../auth/types.js";
import { WorkItemsClient } from "../clients/work-items-client.js";
import { projectNameSchema, workItemIdSchema, topSchema } from "../validation/common.js";
import { withErrorHandling } from "../utils/errors.js";

export function registerWorkItemsTools(server: McpServer, config: AdoConfig): void {
  const client = new WorkItemsClient(config);

  // --- ado_workitems_query ---
  server.registerTool(
    "ado_workitems_query",
    {
      description:
        "Run a WIQL (Work Item Query Language) query against Azure DevOps and return matching work items. " +
        "Example: SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' AND [System.State] <> 'Closed'. " +
        "Returns ID, title, state, type, and assignee for each match. Use ado_workitems_get for full details on a specific item.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(2000)
          .describe("WIQL query string. Must be a SELECT statement."),
        project: projectNameSchema.optional().describe("Project to query. Uses default if omitted."),
        top: topSchema.describe("Max results (default 50, max 200)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ query, project, top }) => {
      const results = await client.query(query, { project, top });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: results.length, workItems: results },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  // --- ado_workitems_get ---
  server.registerTool(
    "ado_workitems_get",
    {
      description:
        "Get full details of a single work item by its ID, including all fields, description, tags, and relations. " +
        "Use ado_workitems_query or ado_workitems_list_recent to find work item IDs first.",
      inputSchema: {
        id: workItemIdSchema,
        project: projectNameSchema
          .optional()
          .describe("Project scope. Optional — work items can be fetched by ID across projects."),
        expand: z
          .enum(["all", "relations", "fields", "none"])
          .default("all")
          .describe("Level of detail: 'all' includes relations and fields, 'none' for minimal."),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ id, project, expand }) => {
      const result = await client.get(id, { project, expand });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }),
  );

  // --- ado_workitems_create ---
  server.registerTool(
    "ado_workitems_create",
    {
      description:
        "Create a new work item in Azure DevOps. Specify the project, type (Bug, Task, User Story, Epic, Feature, etc.), " +
        "and fields. Returns the created work item with its ID. Requires vso.work_write PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project to create the work item in"),
        type: z
          .string()
          .min(1)
          .max(128)
          .describe("Work item type: Bug, Task, User Story, Epic, Feature, Issue, etc."),
        title: z.string().min(1).max(256).describe("Work item title"),
        description: z
          .string()
          .max(10000)
          .optional()
          .describe("HTML or plain text description"),
        assignedTo: z
          .string()
          .max(256)
          .optional()
          .describe("Display name or email of the assignee"),
        areaPath: z.string().max(256).optional().describe("Area path, e.g. 'ProjectName\\\\Team'"),
        iterationPath: z
          .string()
          .max(256)
          .optional()
          .describe("Iteration path, e.g. 'ProjectName\\\\Sprint 1'"),
        priority: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe("Priority: 1 (Critical) to 4 (Low)"),
        tags: z.string().max(1000).optional().describe("Semicolon-separated tags"),
        additionalFields: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Additional fields as key-value pairs. Keys should be field reference names like 'System.State' or 'Microsoft.VSTS.Common.Priority'.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, type, title, description, assignedTo, areaPath, iterationPath, priority, tags, additionalFields }) => {
      const fields: Record<string, string | number> = {
        "System.Title": title,
      };

      if (description) fields["System.Description"] = description;
      if (assignedTo) fields["System.AssignedTo"] = assignedTo;
      if (areaPath) fields["System.AreaPath"] = areaPath;
      if (iterationPath) fields["System.IterationPath"] = iterationPath;
      if (priority) fields["Microsoft.VSTS.Common.Priority"] = priority;
      if (tags) fields["System.Tags"] = tags;

      if (additionalFields) {
        Object.assign(fields, additionalFields);
      }

      const result = await client.create(project, type, fields);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: `Created ${type} #${result.id}: ${result.title}`,
                workItem: result,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  // --- ado_workitems_update ---
  server.registerTool(
    "ado_workitems_update",
    {
      description:
        "Update fields on an existing work item. Pass the work item ID and a map of field names to new values. " +
        "Common fields: System.State, System.AssignedTo, System.Title, System.Tags, Microsoft.VSTS.Common.Priority. " +
        "Requires vso.work_write PAT scope.",
      inputSchema: {
        id: workItemIdSchema,
        project: projectNameSchema.optional().describe("Project scope (optional)"),
        fields: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .describe(
            "Fields to update as key-value pairs. Keys are field reference names like 'System.State'.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ id, project, fields }) => {
      const result = await client.update(id, fields, { project });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: `Updated work item #${result.id}`,
                workItem: result,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  // --- ado_workitems_list_recent ---
  server.registerTool(
    "ado_workitems_list_recent",
    {
      description:
        "List recently updated work items in a project, with optional filters for type, state, and assignee. " +
        "Results are ordered by last changed date (newest first). " +
        "Use this for quick overviews; use ado_workitems_query for complex filtering.",
      inputSchema: {
        project: projectNameSchema.describe("Project to list work items from"),
        type: z
          .string()
          .max(128)
          .optional()
          .describe("Filter by work item type: Bug, Task, User Story, etc."),
        state: z
          .string()
          .max(64)
          .optional()
          .describe("Filter by state: New, Active, Resolved, Closed, etc."),
        assignedTo: z
          .string()
          .max(256)
          .optional()
          .describe("Filter by assignee display name or email"),
        top: topSchema.describe("Max results (default 50, max 200)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, type, state, assignedTo, top }) => {
      const conditions: string[] = [];
      if (type) conditions.push(`[System.WorkItemType] = '${type.replace(/'/g, "''")}'`);
      if (state) conditions.push(`[System.State] = '${state.replace(/'/g, "''")}'`);
      if (assignedTo)
        conditions.push(`[System.AssignedTo] = '${assignedTo.replace(/'/g, "''")}'`);

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const wiql = `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems ${where} ORDER BY [System.ChangedDate] DESC`;

      const results = await client.query(wiql, { project, top });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: results.length, workItems: results },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );
}
