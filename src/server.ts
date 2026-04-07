/**
 * MCP Server setup — creates the McpServer instance and registers all tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "./auth/types.js";
import { registerProjectsTools } from "./tools/projects.js";
import { registerWorkItemsTools } from "./tools/work-items.js";
import { registerGitTools } from "./tools/git.js";
import { registerSearchTools } from "./tools/search.js";
import { registerWikiTools } from "./tools/wiki.js";

export function createServer(config: AdoConfig): McpServer {
  const server = new McpServer(
    {
      name: "ado-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Azure DevOps MCP server. Use ado_projects_list to discover projects first. " +
        "Then use work item and git tools scoped to a project. " +
        "Write operations (create, update, comment) require appropriate PAT scopes.",
    },
  );

  registerProjectsTools(server, config);
  registerWorkItemsTools(server, config);
  registerGitTools(server, config);
  registerSearchTools(server, config);
  registerWikiTools(server, config);

  return server;
}
