/**
 * MCP tool registrations for Azure DevOps Code Search.
 * PAT scope: vso.code (read)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AdoConfig } from "../auth/types.js";
import { SearchClient } from "../clients/search-client.js";
import { projectNameSchema } from "../validation/common.js";
import { withErrorHandling } from "../utils/errors.js";

export function registerSearchTools(server: McpServer, config: AdoConfig): void {
  const client = new SearchClient(config);

  server.registerTool(
    "ado_git_search_code",
    {
      description:
        "Search for code across Azure DevOps repositories. Returns matching files with paths, " +
        "repository names, and character-offset positions of each match within the file. " +
        "To read the matched text, fetch the file via the repository API. " +
        "Optionally scope to a project or specific repository. " +
        "Does NOT search work items or wiki — use ado_workitems_query for work item search.",
      inputSchema: {
        searchText: z
          .string()
          .min(1)
          .max(256)
          .describe("Search keywords or phrases. Supports Azure DevOps search syntax."),
        project: projectNameSchema
          .optional()
          .describe("Scope search to a specific project. Searches all projects if omitted."),
        repositoryName: z
          .string()
          .max(256)
          .optional()
          .describe("Scope search to a specific repository name"),
        top: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Max results (default 25, max 100)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ searchText, project, repositoryName, top }) => {
      const result = await client.searchCode(searchText, { project, repositoryName, top });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                totalCount: result.count,
                showing: result.results.length,
                results: result.results.map((r) => ({
                  file: r.fileName,
                  path: r.path,
                  repository: r.repository.name,
                  project: r.project.name,
                  matchCount: r.matches.length,
                  matches: r.matches.slice(0, 5),
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
