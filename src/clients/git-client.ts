/**
 * Azure DevOps Git API client.
 * PAT scope required: vso.code (read), vso.code_write (comments)
 */

import type { AdoConfig } from "../auth/types.js";
import { truncateString } from "../utils/truncate.js";
import { BaseClient } from "./base-client.js";

const COMMENT_MAX_CHARS = 500;

export interface AdoRepository {
  id: string;
  name: string;
  defaultBranch: string;
  size: number;
  webUrl: string;
  project: { id: string; name: string };
}

export interface PullRequestSummary {
  pullRequestId: number;
  title: string;
  description: string;
  status: string;
  createdBy: { displayName: string; id: string; uniqueName: string };
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  repository: { id: string; name: string };
  reviewers: PrReviewer[];
  isDraft: boolean;
  url: string;
  webUrl: string;
}

export interface PrReviewer {
  displayName: string;
  id: string;
  uniqueName: string;
  vote: number;
  isRequired: boolean;
}

export interface PrThread {
  id: number;
  status: string;
  comments: PrComment[];
  threadContext?: {
    filePath: string;
    rightFileStart?: { line: number };
    rightFileEnd?: { line: number };
  };
  isDeleted: boolean;
  publishedDate: string;
}

export interface PrComment {
  id: number;
  content: string;
  author: string;
  publishedDate: string;
  commentType: string;
}

interface ReposResponse {
  value: RawRepo[];
  count: number;
}

interface RawRepo {
  id: string;
  name: string;
  defaultBranch?: string;
  size: number;
  webUrl: string;
  project: { id: string; name: string };
}

interface PullRequestsResponse {
  value: RawPullRequest[];
  count: number;
}

interface RawPullRequest {
  pullRequestId: number;
  title: string;
  description: string;
  status: string;
  createdBy: { displayName: string; id?: string; uniqueName?: string };
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  repository: { id: string; name: string };
  reviewers: {
    displayName: string;
    id?: string;
    uniqueName?: string;
    vote: number;
    isRequired: boolean;
  }[];
  isDraft: boolean;
  url: string;
  _links?: { web?: { href: string } };
}

interface ThreadsResponse {
  value: RawThread[];
  count: number;
}

interface RawThread {
  id: number;
  status: string;
  comments: {
    id: number;
    content: string;
    author: { displayName: string };
    publishedDate: string;
    commentType: string;
  }[];
  threadContext?: {
    filePath: string;
    rightFileStart?: { line: number };
    rightFileEnd?: { line: number };
  };
  isDeleted: boolean;
  publishedDate: string;
}

export class GitClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
  }

  async listRepositories(project: string): Promise<AdoRepository[]> {
    const response = await this.request<ReposResponse>("git/repositories", {
      project,
    });

    return response.value.map((r) => ({
      id: r.id,
      name: r.name,
      defaultBranch: r.defaultBranch || "",
      size: r.size,
      webUrl: r.webUrl,
      project: r.project,
    }));
  }

  async listPullRequests(
    project: string,
    options: {
      repositoryId?: string;
      status?: string;
      creatorId?: string;
      top?: number;
    } = {},
  ): Promise<PullRequestSummary[]> {
    const repoPath = options.repositoryId
      ? `git/repositories/${encodeURIComponent(options.repositoryId)}/pullrequests`
      : "git/pullrequests";

    const params = new URLSearchParams();
    if (options.status) {
      params.set("searchCriteria.status", options.status);
    }
    if (options.creatorId) {
      params.set("searchCriteria.creatorId", options.creatorId);
    }
    if (options.top) {
      params.set("$top", String(options.top));
    }

    const query = params.toString();
    const path = query ? `${repoPath}?${query}` : repoPath;

    const response = await this.request<PullRequestsResponse>(path, { project });

    return response.value.map(mapPullRequest);
  }

  async getPullRequest(
    project: string,
    repositoryId: string,
    pullRequestId: number,
  ): Promise<PullRequestSummary> {
    const raw = await this.request<RawPullRequest>(
      `git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}`,
      { project },
    );

    return mapPullRequest(raw);
  }

  async getPullRequestThreads(
    project: string,
    repositoryId: string,
    pullRequestId: number,
  ): Promise<PrThread[]> {
    const response = await this.request<ThreadsResponse>(
      `git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/threads`,
      { project },
    );

    return response.value.map((t) => ({
      id: t.id,
      status: t.status || "",
      comments: t.comments.map((c) => ({
        id: c.id,
        content: c.content,
        author: c.author.displayName,
        publishedDate: c.publishedDate,
        commentType: c.commentType,
      })),
      threadContext: t.threadContext,
      isDeleted: t.isDeleted,
      publishedDate: t.publishedDate,
    }));
  }

  async createComment(
    project: string,
    repositoryId: string,
    pullRequestId: number,
    options: {
      content: string;
      threadId?: number;
      filePath?: string;
      lineNumber?: number;
      endLineNumber?: number;
      side?: "right" | "left";
    },
  ): Promise<PrThread> {
    if (options.threadId) {
      // Reply to existing thread
      const raw = await this.request<RawThread>(
        `git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/threads/${options.threadId}/comments`,
        {
          method: "POST",
          body: {
            content: options.content,
            commentType: 1,
          },
          project,
        },
      );
      return mapThread(raw);
    }

    // Create new thread
    const body: Record<string, unknown> = {
      comments: [{ content: options.content, commentType: 1 }],
      status: 1, // active
    };

    if (options.filePath) {
      const side = options.side ?? "right";
      const startLine = options.lineNumber;
      const endLine = options.endLineNumber ?? startLine;
      const startPos = startLine ? { line: startLine, offset: 1 } : undefined;
      const endPos = endLine ? { line: endLine, offset: 1 } : undefined;

      body.threadContext =
        side === "left"
          ? {
              filePath: options.filePath,
              leftFileStart: startPos,
              leftFileEnd: endPos,
            }
          : {
              filePath: options.filePath,
              rightFileStart: startPos,
              rightFileEnd: endPos,
            };
    }

    const raw = await this.request<RawThread>(
      `git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/threads`,
      {
        method: "POST",
        body,
        project,
      },
    );

    return mapThread(raw);
  }
}

function mapThread(raw: RawThread): PrThread {
  return {
    id: raw.id,
    status: raw.status || "",
    comments: raw.comments.map((c) => ({
      id: c.id,
      content: truncateString(c.content || "", COMMENT_MAX_CHARS),
      author: c.author.displayName,
      publishedDate: c.publishedDate,
      commentType: c.commentType,
    })),
    threadContext: raw.threadContext,
    isDeleted: raw.isDeleted,
    publishedDate: raw.publishedDate,
  };
}

function mapPullRequest(raw: RawPullRequest): PullRequestSummary {
  return {
    pullRequestId: raw.pullRequestId,
    title: raw.title,
    description: raw.description || "",
    status: raw.status,
    createdBy: {
      displayName: raw.createdBy.displayName,
      id: raw.createdBy.id ?? "",
      uniqueName: raw.createdBy.uniqueName ?? "",
    },
    creationDate: raw.creationDate,
    sourceRefName: raw.sourceRefName,
    targetRefName: raw.targetRefName,
    repository: raw.repository,
    reviewers: raw.reviewers.map((r) => ({
      displayName: r.displayName,
      id: r.id ?? "",
      uniqueName: r.uniqueName ?? "",
      vote: r.vote,
      isRequired: r.isRequired,
    })),
    isDraft: raw.isDraft,
    url: raw.url,
    webUrl: raw._links?.web?.href ?? raw.url,
  };
}
