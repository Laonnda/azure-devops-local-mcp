/**
 * Azure DevOps Pipelines / Build API client.
 * PAT scope required: vso.build (read), vso.build_execute (queue runs)
 */

import type { AdoConfig } from "../auth/types.js";
import { BaseClient } from "./base-client.js";

/** Max bytes for log list responses to prevent context overflow */
const MAX_LOG_BYTES = 10 * 1024; // 10 KB

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface PipelineDefinition {
  id: number;
  name: string;
  folder: string;
  revision: number;
  url: string;
  webUrl: string;
}

export interface PipelineRun {
  id: number;
  name: string;
  state: string;
  result: string | null;
  createdDate: string;
  finishedDate: string | null;
  pipeline: { id: number; name: string; url: string };
  url: string;
}

export interface BuildRunSummary {
  id: number;
  buildNumber: string;
  status: string;
  result: string | null;
  queueTime: string;
  startTime: string | null;
  finishTime: string | null;
  definitionId: number;
  definitionName: string;
  requestedFor: string;
  sourceBranch: string;
  sourceVersion: string;
  url: string;
}

export interface BuildLog {
  id: number;
  type: string;
  url: string;
  lineCount: number;
}

export interface BuildLogsResult {
  logs: BuildLog[];
  truncated: boolean;
}

// ─── Raw API response interfaces ──────────────────────────────────────────────

interface RawPipelineDefinition {
  id: number;
  name: string;
  folder?: string;
  revision?: number;
  url: string;
  _links?: {
    web?: { href: string };
    self?: { href: string };
  };
}

interface RawListResponse<T> {
  count: number;
  value: T[];
}

interface RawPipelineRun {
  id: number;
  name: string;
  state: string;
  result?: string;
  createdDate: string;
  finishedDate?: string;
  pipeline: { id: number; name: string; url: string };
  url: string;
}

interface RawBuild {
  id: number;
  buildNumber: string;
  status: string;
  result?: string;
  queueTime: string;
  startTime?: string;
  finishTime?: string;
  definition: { id: number; name: string };
  requestedFor?: { displayName: string };
  sourceBranch?: string;
  sourceVersion?: string;
  url: string;
}

interface RawBuildLog {
  id: number;
  type: string;
  url: string;
  lineCount?: number;
}

interface RawBuildLogsResponse {
  count: number;
  value: RawBuildLog[];
}

// ─── Mapper functions ─────────────────────────────────────────────────────────

function mapPipelineDefinition(raw: RawPipelineDefinition): PipelineDefinition {
  return {
    id: raw.id,
    name: raw.name,
    folder: raw.folder || "\\",
    revision: raw.revision ?? 1,
    url: raw.url,
    webUrl: raw._links?.web?.href || raw.url,
  };
}

function mapPipelineRun(raw: RawPipelineRun): PipelineRun {
  return {
    id: raw.id,
    name: raw.name,
    state: raw.state,
    result: raw.result ?? null,
    createdDate: raw.createdDate,
    finishedDate: raw.finishedDate ?? null,
    pipeline: raw.pipeline,
    url: raw.url,
  };
}

function mapBuild(raw: RawBuild): BuildRunSummary {
  return {
    id: raw.id,
    buildNumber: raw.buildNumber,
    status: raw.status,
    result: raw.result ?? null,
    queueTime: raw.queueTime,
    startTime: raw.startTime ?? null,
    finishTime: raw.finishTime ?? null,
    definitionId: raw.definition?.id,
    definitionName: raw.definition?.name || "",
    requestedFor: raw.requestedFor?.displayName || "",
    sourceBranch: raw.sourceBranch || "",
    sourceVersion: raw.sourceVersion || "",
    url: raw.url,
  };
}

function mapBuildLog(raw: RawBuildLog): BuildLog {
  return {
    id: raw.id,
    type: raw.type,
    url: raw.url,
    lineCount: raw.lineCount ?? 0,
  };
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class PipelinesClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
  }

  /**
   * List pipeline definitions for a project.
   * PAT scope: vso.build
   */
  async listDefinitions(
    project?: string,
    opts: { top?: number } = {},
  ): Promise<PipelineDefinition[]> {
    const resolvedProject = this.resolveProject(project);
    const top = opts.top ?? 50;

    const raw = await this.request<RawListResponse<RawPipelineDefinition>>(
      `pipelines?$top=${top}`,
      { project: resolvedProject },
    );

    return (raw.value || []).map(mapPipelineDefinition);
  }

  /**
   * Get a single pipeline run by pipeline ID and run ID.
   * PAT scope: vso.build
   */
  async getRun(project: string, pipelineId: number, runId: number): Promise<PipelineRun> {
    const resolvedProject = this.resolveProject(project);

    const raw = await this.request<RawPipelineRun>(
      `pipelines/${pipelineId}/runs/${runId}`,
      { project: resolvedProject },
    );

    return mapPipelineRun(raw);
  }

  /**
   * List recent builds/runs for a project, optionally filtered by pipeline definition.
   * Uses the build/builds endpoint for richer status/result filtering.
   * PAT scope: vso.build
   */
  async listRuns(
    project?: string,
    pipelineId?: number,
    opts: {
      top?: number;
      statusFilter?: string;
      continuationToken?: string;
    } = {},
  ): Promise<BuildRunSummary[]> {
    const resolvedProject = this.resolveProject(project);
    const top = opts.top ?? 25;

    const params = new URLSearchParams();
    params.set("$top", String(top));
    if (pipelineId !== undefined) {
      params.set("definitions", String(pipelineId));
    }
    if (opts.statusFilter && opts.statusFilter !== "all") {
      params.set("statusFilter", opts.statusFilter);
    }
    if (opts.continuationToken) {
      params.set("continuationToken", opts.continuationToken);
    }

    const raw = await this.request<RawListResponse<RawBuild>>(
      `build/builds?${params.toString()}`,
      { project: resolvedProject },
    );

    return (raw.value || []).map(mapBuild);
  }

  /**
   * Queue a new pipeline run.
   * PAT scope: vso.build_execute
   */
  async queueRun(
    project: string,
    pipelineId: number,
    opts: {
      branch?: string;
      variables?: Record<string, { value: string; isSecret?: boolean }>;
      stagesToSkip?: string[];
    } = {},
  ): Promise<PipelineRun> {
    const resolvedProject = this.resolveProject(project);

    const body: Record<string, unknown> = {};
    if (opts.branch) {
      body.resources = { repositories: { self: { refName: opts.branch } } };
    }
    if (opts.variables) {
      body.variables = opts.variables;
    }
    if (opts.stagesToSkip?.length) {
      body.stagesToSkip = opts.stagesToSkip;
    }

    const raw = await this.request<RawPipelineRun>(
      `pipelines/${pipelineId}/runs`,
      { method: "POST", body, project: resolvedProject },
    );

    return mapPipelineRun(raw);
  }

  /**
   * Fetch build log references for a build.
   * Returns log metadata list truncated to 10 KB to prevent context overflow.
   * To read actual log content, follow the `url` of each BuildLog entry.
   * PAT scope: vso.build
   */
  async getLogs(project: string, buildId: number): Promise<BuildLogsResult> {
    const resolvedProject = this.resolveProject(project);

    const raw = await this.request<RawBuildLogsResponse>(
      `build/builds/${buildId}/logs`,
      { project: resolvedProject },
    );

    const logs = (raw.value || []).map(mapBuildLog);
    const serialized = JSON.stringify(logs);

    if (serialized.length <= MAX_LOG_BYTES) {
      return { logs, truncated: false };
    }

    // Include as many log entries as fit within the byte budget
    const truncatedLogs: BuildLog[] = [];
    let bytes = 2; // for surrounding "[]"
    for (const log of logs) {
      const entry = JSON.stringify(log);
      const comma = truncatedLogs.length > 0 ? 1 : 0;
      if (bytes + entry.length + comma > MAX_LOG_BYTES) break;
      truncatedLogs.push(log);
      bytes += entry.length + comma;
    }

    return { logs: truncatedLogs, truncated: true };
  }
}
