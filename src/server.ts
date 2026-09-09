/**
 * MCP Server setup — creates the McpServer instance and registers all tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "./auth/types.js";
import { VERSION } from "./utils/version.js";
import { registerProjectsTools } from "./tools/projects.js";
import { registerWorkItemsTools } from "./tools/work-items.js";
import { registerGitTools } from "./tools/git.js";
import { registerSearchTools } from "./tools/search.js";
import { registerWikiTools } from "./tools/wiki.js";
import { registerPipelinesTools } from "./tools/pipelines.js";
import { registerTestPlansTools } from "./tools/test-plans.js";

export function createServer(config: AdoConfig): McpServer {
  const server = new McpServer(
    {
      name: "azure-devops-local-mcp",
      version: VERSION,
    },
    {
      instructions:
        "Azure DevOps MCP server. Use ado_projects_list to discover projects first. " +
        "Then use work item and git tools scoped to a project. " +
        "Write operations (create, update, comment) require appropriate PAT scopes. " +
        "Test plan tools require vso.test (read) or vso.test_write (create/update).",
    },
  );

  if (config.readOnly) {
    // Read-only mode: skip registering any tool not annotated readOnlyHint: true.
    const original = server.registerTool.bind(server) as (
      name: string,
      definition: { annotations?: { readOnlyHint?: boolean } },
      handler: unknown,
    ) => unknown;
    (server as { registerTool: unknown }).registerTool = (
      name: string,
      definition: { annotations?: { readOnlyHint?: boolean } },
      handler: unknown,
    ): unknown => {
      if (definition.annotations?.readOnlyHint === true) {
        return original(name, definition, handler);
      }
      return undefined;
    };
  }

  registerProjectsTools(server, config);
  registerWorkItemsTools(server, config);
  registerGitTools(server, config);
  registerSearchTools(server, config);
  registerWikiTools(server, config);
  registerPipelinesTools(server, config);
  registerTestPlansTools(server, config);

  return server;
}
