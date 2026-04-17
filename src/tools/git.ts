/**
 * MCP tool registrations for Azure DevOps Git & Pull Requests.
 * PAT scope: vso.code (read), vso.code_write (comments)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AdoConfig } from "../auth/types.js";
import { GitClient } from "../clients/git-client.js";
import {
  projectNameSchema,
  repositoryIdSchema,
  pullRequestIdSchema,
  topSchema,
  guidSchema,
} from "../validation/common.js";
import { withErrorHandling, ValidationError } from "../utils/errors.js";

export function registerGitTools(server: McpServer, config: AdoConfig): void {
  const client = new GitClient(config);

  // --- ado_git_list_repos ---
  server.registerTool(
    "ado_git_list_repos",
    {
      description:
        "List Git repositories in an Azure DevOps project. " +
        "Returns repository ID, name, default branch, and size. " +
        "Use the repository ID in other git tools (PRs, search).",
      inputSchema: {
        project: projectNameSchema.describe("Project to list repositories from"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project }) => {
      const repos = await client.listRepositories(project);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: repos.length,
                repositories: repos.map((r) => ({
                  id: r.id,
                  name: r.name,
                  defaultBranch: r.defaultBranch,
                  size: r.size,
                  webUrl: r.webUrl,
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

  // --- ado_git_list_prs ---
  server.registerTool(
    "ado_git_list_prs",
    {
      description:
        "List pull requests in a project or specific repository. Filter by status (active, completed, abandoned) " +
        "and creator. Returns PR ID, title, status, branches, creator, and reviewers. " +
        "Use ado_git_get_pr for full details on a specific PR.",
      inputSchema: {
        project: projectNameSchema.describe("Project to list PRs from"),
        repositoryId: repositoryIdSchema
          .optional()
          .describe(
            "Repository ID or name. If omitted, lists PRs across all repos in the project.",
          ),
        status: z
          .enum(["active", "completed", "abandoned", "all"])
          .default("active")
          .describe("Filter by PR status. Defaults to 'active'."),
        creatorId: guidSchema.optional().describe("Filter by creator's ID (GUID)"),
        top: topSchema.describe("Max results (default 50, max 200)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, repositoryId, status, creatorId, top }) => {
      const prs = await client.listPullRequests(project, {
        repositoryId,
        status,
        creatorId,
        top,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: prs.length,
                pullRequests: prs.map((pr) => ({
                  pullRequestId: pr.pullRequestId,
                  title: pr.title,
                  status: pr.status,
                  isDraft: pr.isDraft,
                  createdBy: pr.createdBy,
                  creationDate: pr.creationDate,
                  sourceBranch: pr.sourceRefName.replace("refs/heads/", ""),
                  targetBranch: pr.targetRefName.replace("refs/heads/", ""),
                  repository: pr.repository.name,
                  reviewers: pr.reviewers.map((r) => ({
                    name: r.displayName,
                    id: r.id,
                    uniqueName: r.uniqueName,
                    vote: r.vote,
                    required: r.isRequired,
                  })),
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

  // --- ado_git_get_pr ---
  server.registerTool(
    "ado_git_get_pr",
    {
      description:
        "Get full details of a specific pull request, including title, description, reviewers, " +
        "source/target branches, and status. Use ado_git_get_pr_threads for comments/discussions.",
      inputSchema: {
        project: projectNameSchema.describe("Project containing the PR"),
        repositoryId: repositoryIdSchema.describe("Repository ID or name"),
        pullRequestId: pullRequestIdSchema.describe("Pull request ID"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, repositoryId, pullRequestId }) => {
      const pr = await client.getPullRequest(project, repositoryId, pullRequestId);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(pr, null, 2),
          },
        ],
      };
    }),
  );

  // --- ado_git_get_pr_threads ---
  server.registerTool(
    "ado_git_get_pr_threads",
    {
      description:
        "Get all comment threads on a pull request, including inline code comments with file paths " +
        "and line numbers. Use ado_git_create_pr_comment to reply to a thread or add a new comment.",
      inputSchema: {
        project: projectNameSchema.describe("Project containing the PR"),
        repositoryId: repositoryIdSchema.describe("Repository ID or name"),
        pullRequestId: pullRequestIdSchema.describe("Pull request ID"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, repositoryId, pullRequestId }) => {
      const threads = await client.getPullRequestThreads(project, repositoryId, pullRequestId);

      // Filter out deleted threads and system threads for cleaner output
      const activeThreads = threads.filter((t) => !t.isDeleted);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: activeThreads.length,
                threads: activeThreads.map((t) => ({
                  threadId: t.id,
                  status: t.status,
                  filePath: t.threadContext?.filePath,
                  line: t.threadContext?.rightFileStart?.line,
                  comments: t.comments.map((c) => ({
                    id: c.id,
                    author: c.author,
                    content: c.content,
                    date: c.publishedDate,
                  })),
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

  // --- ado_git_create_pr_comment ---
  server.registerTool(
    "ado_git_create_pr_comment",
    {
      description:
        "Add a comment to a pull request. " +
        "To reply to an existing thread, provide threadId (do not provide filePath). " +
        "To create a new general thread, provide only content. " +
        "To create an inline code comment, provide filePath; optionally add lineNumber (start) " +
        "and endLineNumber (end) for a multi-line range, and side ('right' for new file, 'left' for old). " +
        "Requires vso.code_write PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project containing the PR"),
        repositoryId: repositoryIdSchema.describe("Repository ID or name"),
        pullRequestId: pullRequestIdSchema.describe("Pull request ID"),
        content: z.string().min(1).max(10000).describe("Comment text (supports markdown)"),
        threadId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Thread ID to reply to. Mutually exclusive with filePath."),
        filePath: z
          .string()
          .max(500)
          .optional()
          .describe(
            "File path for an inline comment (e.g. '/src/index.ts'). " +
              "Only for new threads; mutually exclusive with threadId.",
          ),
        lineNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Start line number for the inline comment range. Requires filePath."),
        endLineNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "End line number for a multi-line inline comment. " +
              "Defaults to lineNumber when omitted. Requires filePath.",
          ),
        side: z
          .enum(["right", "left"])
          .default("right")
          .describe(
            "Diff side for the inline comment: 'right' (new file, default) or 'left' (old file). " +
              "Only used with filePath.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(
      async ({
        project,
        repositoryId,
        pullRequestId,
        content,
        threadId,
        filePath,
        lineNumber,
        endLineNumber,
        side,
      }) => {
        if (threadId !== undefined && filePath !== undefined) {
          throw new ValidationError("threadId and filePath are mutually exclusive: use threadId to reply to an existing thread, or filePath to create an inline comment on a new thread.");
        }

        const result = await client.createComment(project, repositoryId, pullRequestId, {
          content,
          threadId,
          filePath,
          lineNumber,
          endLineNumber,
          side,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  message: threadId
                    ? `Replied to thread #${threadId}`
                    : `Created new comment thread #${result.id}`,
                  thread: result,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    ),
  );
}
