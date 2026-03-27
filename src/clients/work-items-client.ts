/**
 * Azure DevOps Work Item Tracking API client.
 * PAT scope required: vso.work (read), vso.work_write (create/update)
 */

import type { AdoConfig } from "../auth/types.js";
import { ValidationError } from "../utils/errors.js";
import { BaseClient } from "./base-client.js";

export interface WorkItemSummary {
  id: number;
  title: string;
  state: string;
  type: string;
  assignedTo: string;
  areaPath: string;
  iterationPath: string;
  changedDate: string;
  url: string;
}

export interface WorkItemDetail extends WorkItemSummary {
  description: string;
  reason: string;
  priority: number;
  tags: string;
  relations: WorkItemRelation[];
  rev: number;
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes: Record<string, unknown>;
}

interface WiqlResponse {
  queryType: string;
  workItems: { id: number; url: string }[];
}

interface WorkItemResponse {
  id: number;
  rev: number;
  url: string;
  fields: Record<string, unknown>;
  relations?: WorkItemRelation[];
}

interface WorkItemsBatchResponse {
  value: WorkItemResponse[];
  count: number;
}

/** Patterns that should not appear in WIQL queries */
const WIQL_BLOCKED_PATTERNS = [/;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC)/i];

function validateWiql(query: string): void {
  for (const pattern of WIQL_BLOCKED_PATTERNS) {
    if (pattern.test(query)) {
      throw new ValidationError("WIQL query contains blocked SQL-like patterns");
    }
  }
  if (query.length > 2000) {
    throw new ValidationError("WIQL query exceeds maximum length of 2000 characters");
  }
}

function mapWorkItem(raw: WorkItemResponse): WorkItemSummary {
  const f = raw.fields;
  return {
    id: raw.id,
    title: String(f["System.Title"] || ""),
    state: String(f["System.State"] || ""),
    type: String(f["System.WorkItemType"] || ""),
    assignedTo: extractDisplayName(f["System.AssignedTo"]),
    areaPath: String(f["System.AreaPath"] || ""),
    iterationPath: String(f["System.IterationPath"] || ""),
    changedDate: String(f["System.ChangedDate"] || ""),
    url: raw.url,
  };
}

function mapWorkItemDetail(raw: WorkItemResponse): WorkItemDetail {
  const f = raw.fields;
  return {
    ...mapWorkItem(raw),
    description: String(f["System.Description"] || ""),
    reason: String(f["System.Reason"] || ""),
    priority: Number(f["Microsoft.VSTS.Common.Priority"] || 0),
    tags: String(f["System.Tags"] || ""),
    relations: raw.relations || [],
    rev: raw.rev,
  };
}

function extractDisplayName(field: unknown): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field !== null && "displayName" in field) {
    return String((field as { displayName: string }).displayName);
  }
  return "";
}

export class WorkItemsClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
  }

  /**
   * Run a WIQL query and return work item summaries.
   */
  async query(
    wiql: string,
    options: { project?: string; top?: number } = {},
  ): Promise<WorkItemSummary[]> {
    validateWiql(wiql);

    const project = this.resolveProject(options.project);
    const top = options.top || 50;

    const wiqlResult = await this.request<WiqlResponse>(`wit/wiql?$top=${top}`, {
      method: "POST",
      body: { query: wiql },
      project,
    });

    if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
      return [];
    }

    return this.batchGetWorkItems(
      wiqlResult.workItems.map((wi) => wi.id),
      project,
    );
  }

  /**
   * Get a single work item by ID.
   */
  async get(
    id: number,
    options: { project?: string; expand?: string } = {},
  ): Promise<WorkItemDetail> {
    const project = options.project || this.defaultProject;
    const expand = options.expand || "all";

    const raw = await this.request<WorkItemResponse>(`wit/workitems/${id}?$expand=${expand}`, {
      project,
      useProjectScope: !!project,
    });

    return mapWorkItemDetail(raw);
  }

  /**
   * Create a new work item.
   */
  async create(
    project: string,
    type: string,
    fields: Record<string, string | number>,
  ): Promise<WorkItemDetail> {
    const patchDoc = Object.entries(fields).map(([path, value]) => ({
      op: "add" as const,
      path: path.startsWith("/fields/") ? path : `/fields/${path}`,
      value,
    }));

    const raw = await this.request<WorkItemResponse>(`wit/workitems/$${encodeURIComponent(type)}`, {
      method: "POST",
      body: patchDoc,
      contentType: "application/json-patch+json",
      project,
    });

    return mapWorkItemDetail(raw);
  }

  /**
   * Update an existing work item.
   */
  async update(
    id: number,
    fields: Record<string, string | number>,
    options: { project?: string } = {},
  ): Promise<WorkItemDetail> {
    const project = options.project || this.defaultProject;
    const patchDoc = Object.entries(fields).map(([path, value]) => ({
      op: "replace" as const,
      path: path.startsWith("/fields/") ? path : `/fields/${path}`,
      value,
    }));

    const raw = await this.request<WorkItemResponse>(`wit/workitems/${id}`, {
      method: "PATCH",
      body: patchDoc,
      contentType: "application/json-patch+json",
      project,
      useProjectScope: !!project,
    });

    return mapWorkItemDetail(raw);
  }

  /**
   * Batch fetch work items by IDs (max 200 per call).
   */
  private async batchGetWorkItems(ids: number[], project: string): Promise<WorkItemSummary[]> {
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 200) {
      chunks.push(ids.slice(i, i + 200));
    }

    const results: WorkItemSummary[] = [];
    for (const chunk of chunks) {
      const idsParam = chunk.join(",");
      const response = await this.request<WorkItemsBatchResponse>(
        `wit/workitems?ids=${idsParam}&$expand=none`,
        { project },
      );
      results.push(...response.value.map(mapWorkItem));
    }

    return results;
  }
}
