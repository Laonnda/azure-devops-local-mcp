/**
 * MCP tool registrations for Azure DevOps Wiki.
 * PAT scope: vso.wiki (read), vso.wiki_write (write)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AdoConfig } from "../auth/types.js";
import { WikiClient } from "../clients/wiki-client.js";
import { projectNameSchema, wikiIdSchema, wikiPathSchema, topSchema, skipSchema } from "../validation/common.js";
import { withErrorHandling } from "../utils/errors.js";

export function registerWikiTools(server: McpServer, config: AdoConfig): void {
  const client = new WikiClient(config);

  // --- ado_wiki_get_page ---
  server.registerTool(
    "ado_wiki_get_page",
    {
      description:
        "Fetch the content and metadata of a single Azure DevOps wiki page by its path. " +
        "Returns the page content (Markdown), URL, last updated date, and version. " +
        "Requires vso.wiki PAT scope.",
      inputSchema: {
        wikiId: wikiIdSchema.describe("Wiki ID (GUID) or wiki name"),
        path: wikiPathSchema.describe("Wiki page path (e.g. /MyPage or /Parent/Child)"),
        project: projectNameSchema.optional().describe("Project name. Uses default if omitted."),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ wikiId, path, project }) => {
      const resolvedProject = project ?? config.defaultProject ?? "";
      const result = await client.getPage(resolvedProject, wikiId, path);

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

  // --- ado_wiki_list_pages ---
  server.registerTool(
    "ado_wiki_list_pages",
    {
      description:
        "List pages in an Azure DevOps wiki with optional pagination. " +
        "Returns a list of pages with their paths, URLs, and metadata. " +
        "Use top and skip for pagination. Requires vso.wiki PAT scope.",
      inputSchema: {
        wikiId: wikiIdSchema.describe("Wiki ID (GUID) or wiki name"),
        project: projectNameSchema.optional().describe("Project name. Uses default if omitted."),
        top: topSchema.describe("Max results (default 50, max 200)"),
        skip: skipSchema.describe("Number of results to skip for pagination"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ wikiId, project, top, skip }) => {
      const resolvedProject = project ?? config.defaultProject ?? "";
      const result = await client.listPages(resolvedProject, wikiId, { top, skip });

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

  // --- ado_wiki_update_page ---
  server.registerTool(
    "ado_wiki_update_page",
    {
      description:
        "Create or update an Azure DevOps wiki page at the specified path. " +
        "If the page does not exist it will be created; if it exists it will be updated. " +
        "Returns the updated page content and metadata. Requires vso.wiki_write PAT scope.",
      inputSchema: {
        wikiId: wikiIdSchema.describe("Wiki ID (GUID) or wiki name"),
        path: wikiPathSchema.describe("Wiki page path (e.g. /MyPage or /Parent/Child)"),
        content: z.string().min(1).max(100000).describe("Markdown content for the wiki page"),
        project: projectNameSchema.optional().describe("Project name. Uses default if omitted."),
        message: z
          .string()
          .max(256)
          .optional()
          .describe("Optional commit message for the page update"),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ wikiId, path, content, project, message }) => {
      const resolvedProject = project ?? config.defaultProject ?? "";
      const result = await client.updatePage(resolvedProject, wikiId, path, content, message);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: `Wiki page ${path} updated successfully`,
                page: result,
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
