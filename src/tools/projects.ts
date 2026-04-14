/**
 * MCP tool registrations for Azure DevOps Projects.
 * PAT scope: vso.project (read)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "../auth/types.js";
import { ProjectsClient } from "../clients/projects-client.js";
import { topSchema, skipSchema } from "../validation/common.js";
import { withErrorHandling } from "../utils/errors.js";

export function registerProjectsTools(server: McpServer, config: AdoConfig): void {
  const client = new ProjectsClient(config);

  server.registerTool(
    "ado_projects_list",
    {
      description:
        "List all projects in the Azure DevOps organization. " +
        "Use this first to discover available projects before using other tools. " +
        "Returns project name, ID, description, and state.",
      inputSchema: {
        top: topSchema.describe("Max projects to return (default 50, max 200)"),
        skip: skipSchema.describe("Number of projects to skip for pagination"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ top, skip }) => {
      const result = await client.list({ top, skip });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: result.count,
                projects: result.projects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  description: p.description,
                  state: p.state,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );
}
