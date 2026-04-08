/**
 * MCP tool registrations for Azure DevOps Pipelines / Build.
 * PAT scope: vso.build (read), vso.build_execute (queue runs)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AdoConfig } from "../auth/types.js";
import { PipelinesClient } from "../clients/pipelines-client.js";
import {
  projectNameSchema,
  topSchema,
  pipelineIdSchema,
  buildIdSchema,
  statusFilterSchema,
} from "../validation/pipelines.js";
import { continuationTokenSchema } from "../validation/common.js";
import { withErrorHandling } from "../utils/errors.js";

const branchSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\x00-\x1f]+$/)
  .describe("Git branch name or ref (e.g. refs/heads/main)");

const variablesSchema = z
  .record(
    z.string().min(1).max(128),
    z.object({
      value: z.string().max(4096),
      isSecret: z.boolean().optional(),
    }),
  )
  .optional()
  .describe("Pipeline variables to override (name -> { value, isSecret? })");

const stagesToSkipSchema = z
  .array(z.string().min(1).max(256))
  .max(50)
  .optional()
  .describe("Names of stages to skip in this run");

export function registerPipelinesTools(server: McpServer, config: AdoConfig): void {
  const client = new PipelinesClient(config);

  // --- ado_pipelines_list ---
  server.registerTool(
    "ado_pipelines_list",
    {
      description:
        "List pipeline definitions for an Azure DevOps project. " +
        "Returns id, name, folder, revision, and URLs for each pipeline. " +
        "Requires vso.build PAT scope.",
      inputSchema: {
        project: projectNameSchema.optional().describe("Project name. Uses default if omitted."),
        top: topSchema.describe("Max results to return (default 50)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, top }) => {
      const result = await client.listDefinitions(project, { top });

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

  // --- ado_pipelines_get_run ---
  server.registerTool(
    "ado_pipelines_get_run",
    {
      description:
        "Get details of a single Azure DevOps pipeline run by pipeline ID and run ID. " +
        "Returns state, result, timestamps, and URL. " +
        "Requires vso.build PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project name"),
        pipelineId: pipelineIdSchema,
        runId: buildIdSchema.describe("Run ID"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, pipelineId, runId }) => {
      const result = await client.getRun(project, pipelineId, runId);

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

  // --- ado_pipelines_list_runs ---
  server.registerTool(
    "ado_pipelines_list_runs",
    {
      description:
        "List recent pipeline runs for an Azure DevOps project with optional filtering. " +
        "Filter by pipeline definition, status, or paginate with top and continuationToken. " +
        "Requires vso.build PAT scope.",
      inputSchema: {
        project: projectNameSchema.optional().describe("Project name. Uses default if omitted."),
        pipelineId: pipelineIdSchema.optional().describe("Filter to a specific pipeline definition ID"),
        statusFilter: statusFilterSchema.optional().describe("Filter by build status"),
        top: topSchema.describe("Max results to return (default 25)"),
        continuationToken: continuationTokenSchema.optional().describe("Token for next page of results"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, pipelineId, statusFilter, top, continuationToken }) => {
      const result = await client.listRuns(project, pipelineId, {
        top,
        statusFilter,
        continuationToken,
      });

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

  // --- ado_pipelines_trigger ---
  server.registerTool(
    "ado_pipelines_trigger",
    {
      description:
        "Queue a new pipeline run in Azure DevOps. " +
        "This is a WRITE operation — it will immediately queue a run and consume build minutes. " +
        "Optionally override the branch, set pipeline variables, or skip stages. " +
        "Requires vso.build_execute PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project name"),
        pipelineId: pipelineIdSchema,
        branch: branchSchema.optional(),
        variables: variablesSchema,
        stagesToSkip: stagesToSkipSchema,
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, pipelineId, branch, variables, stagesToSkip }) => {
      const result = await client.queueRun(project, pipelineId, {
        branch,
        variables,
        stagesToSkip,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: `Pipeline run queued successfully (run ID: ${result.id})`,
                run: result,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  // --- ado_pipelines_get_logs ---
  server.registerTool(
    "ado_pipelines_get_logs",
    {
      description:
        "Get build log references for an Azure DevOps pipeline run. " +
        "Returns a list of log entries (id, type, url, lineCount) truncated to 10 KB to prevent context overflow. " +
        "Follow the url of each log entry to fetch full log content. " +
        "Requires vso.build PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project name"),
        buildId: buildIdSchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, buildId }) => {
      const result = await client.getLogs(project, buildId);

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
}
