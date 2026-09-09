/**
 * Azure DevOps Work Item Tracking API client.
 * PAT scope required: vso.work (read), vso.work_write (create/update)
 */

import type { AdoConfig } from "../auth/types.js";
import { ValidationError } from "../utils/errors.js";
import { truncateString } from "../utils/truncate.js";
import { BaseClient } from "./base-client.js";

const DESCRIPTION_MAX_CHARS = 500;

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
  webUrl: string;
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

export interface WorkItemQueryResult {
  items: WorkItemSummary[];
  returnedCount: number;
  totalCount: number;
}

interface WiqlResponse {
  queryType: string;
  workItems?: { id: number; url: string }[];
}

interface WorkItemResponse {
  id: number;
  rev: number;
  url: string;
  fields: Record<string, unknown>;
  relations?: WorkItemRelation[];
  _links?: { html?: { href: string } };
}

interface WorkItemsBatchResponse {
  value: WorkItemResponse[];
  count: number;
}

/**
 * Friendly link-type names mapped to Azure DevOps relation reference names.
 * `parent`/`child` are the hierarchy links the board uses for Feature->Task etc.
 */
export const LINK_TYPE_TO_REL = {
  parent: "System.LinkTypes.Hierarchy-Reverse",
  child: "System.LinkTypes.Hierarchy-Forward",
  related: "System.LinkTypes.Related",
  predecessor: "System.LinkTypes.Dependency-Reverse",
  successor: "System.LinkTypes.Dependency-Forward",
  duplicate: "System.LinkTypes.Duplicate-Forward",
  "duplicate-of": "System.LinkTypes.Duplicate-Reverse",
} as const;

export type LinkType = keyof typeof LINK_TYPE_TO_REL;

/** Extract the numeric work item id from a relation's URL. */
function extractWorkItemIdFromUrl(url: string): number | null {
  const match = /\/workItems\/(\d+)(?:[?#/]|$)/i.exec(url);
  return match ? Number(match[1]) : null;
}

/**
 * Azure DevOps rejects `api-version=7.2` on work-item relation patches
 * ("the resource is under preview, -preview flag must be supplied").
 * Pinning link/unlink to the stable 7.1 version keeps them working against
 * standard ADO organisations.
 */
const RELATIONS_API_VERSION = "7.1";

function validateWiql(query: string): void {
  if (query.length > 2000) {
    throw new ValidationError("WIQL query exceeds maximum length of 2000 characters");
  }
  const trimmed = query.trimStart();
  if (!/^SELECT\s/i.test(trimmed)) {
    throw new ValidationError("WIQL query must start with SELECT");
  }
  if (!/FROM\s+WorkItems\b/i.test(trimmed)) {
    throw new ValidationError("WIQL query must query FROM WorkItems");
  }
}

/**
 * Inject [System.TeamProject] = 'project' into a WIQL WHERE clause.
 * Rejects queries that reference [System.TeamProject] themselves — a
 * caller-supplied TeamProject condition (even inside a string literal)
 * would otherwise disable the scoping this function exists to guarantee.
 * Handles WHERE, ORDER BY, ASOF, and bare SELECT forms.
 *
 * Existing WHERE conditions are wrapped in parentheses: AND binds tighter
 * than OR in WIQL, so `TP = 'X' AND a OR b` would leave the OR arm unscoped
 * and match work items from other projects.
 */
export function injectProjectFilter(wiql: string, project: string): string {
  if (/\[System\.TeamProject\]/i.test(wiql)) {
    throw new ValidationError(
      "The query must not reference [System.TeamProject] when a project scope is applied. " +
        "Omit the project parameter to query across projects, or remove the TeamProject condition.",
    );
  }

  const escapedProject = project.replace(/'/g, "''");
  const condition = `[System.TeamProject] = '${escapedProject}'`;
  const tailPattern = /\b(ORDER\s+BY|ASOF)\b/i;

  const whereMatch = /\bWHERE\b/i.exec(wiql);
  if (whereMatch) {
    const condStart = whereMatch.index + whereMatch[0].length;
    const tailMatch = tailPattern.exec(wiql.slice(condStart));
    const condEnd = tailMatch ? condStart + tailMatch.index : wiql.length;
    const existing = wiql.slice(condStart, condEnd).trim();
    const tail = wiql.slice(condEnd).trim();
    const scoped = `${wiql.slice(0, condStart)} ${condition} AND (${existing})`;
    return tail ? `${scoped} ${tail}` : scoped;
  }

  const tailMatch = tailPattern.exec(wiql);
  if (tailMatch) {
    return `${wiql.slice(0, tailMatch.index)}WHERE ${condition} ${wiql.slice(tailMatch.index)}`;
  }

  return `${wiql} WHERE ${condition}`;
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
    webUrl: raw._links?.html?.href ?? "",
  };
}

function mapWorkItemDetail(raw: WorkItemResponse): WorkItemDetail {
  const f = raw.fields;
  return {
    ...mapWorkItem(raw),
    description: truncateString(String(f["System.Description"] || ""), DESCRIPTION_MAX_CHARS),
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
   * Run a WIQL query and return results with pagination metadata.
   * Injects [System.TeamProject] into WHERE to enforce project scoping.
   * Uses $top=20000 (ADO hard cap) to populate totalCount, then slices
   * to the caller's top for the batch fetch.
   */
  async query(
    wiql: string,
    options: { project?: string; top?: number } = {},
  ): Promise<WorkItemQueryResult> {
    validateWiql(wiql);

    const project = this.resolveProject(options.project);
    const top = options.top ?? 50;
    const scopedWiql = injectProjectFilter(wiql, project);

    const wiqlResult = await this.request<WiqlResponse>(`wit/wiql?$top=20000`, {
      method: "POST",
      body: { query: scopedWiql },
      project,
    });

    const allIds = wiqlResult.workItems ?? [];
    const totalCount = allIds.length;
    const ids = allIds.slice(0, top).map((wi) => wi.id);

    if (ids.length === 0) {
      return { items: [], returnedCount: 0, totalCount: 0 };
    }

    const items = await this.batchGetWorkItems(ids, project);
    return { items, returnedCount: items.length, totalCount };
  }

  /**
   * Get a single work item by ID.
   * If `project` is explicitly supplied and the item belongs to a different
   * project, throws ValidationError naming the actual project.
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

    if (options.project) {
      const actualProject = String(raw.fields["System.TeamProject"] || "");
      if (actualProject && actualProject !== options.project) {
        throw new ValidationError(
          `Work item #${id} belongs to project '${actualProject}', not '${options.project}'.`,
        );
      }
    }

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
   * Add a relation (link) from one work item to another.
   *
   * For `linkType="parent"`, the call patches `fromId` so that `toId` becomes
   * its parent on the board (equivalent to dragging `fromId` under `toId`).
   */
  async addRelation(
    fromId: number,
    toId: number,
    linkType: LinkType,
    options: { project?: string; comment?: string } = {},
  ): Promise<WorkItemDetail> {
    if (fromId === toId) {
      throw new ValidationError("Cannot link a work item to itself.");
    }

    const project = options.project || this.defaultProject;
    const rel = LINK_TYPE_TO_REL[linkType];
    const targetUrl = `${this.orgUrl}/_apis/wit/workItems/${toId}`;

    const value: Record<string, unknown> = { rel, url: targetUrl };
    if (options.comment) {
      value.attributes = { comment: options.comment };
    }

    const patchDoc = [{ op: "add" as const, path: "/relations/-", value }];

    const raw = await this.request<WorkItemResponse>(`wit/workitems/${fromId}`, {
      method: "PATCH",
      body: patchDoc,
      contentType: "application/json-patch+json",
      project,
      useProjectScope: !!project,
      apiVersion: RELATIONS_API_VERSION,
    });

    return mapWorkItemDetail(raw);
  }

  /**
   * Remove a relation from a work item. Looks up the relation by target id
   * and rel type, then deletes it by index (the only form ADO accepts).
   * Errors if the relation is not present.
   */
  async removeRelation(
    fromId: number,
    toId: number,
    linkType: LinkType,
    options: { project?: string } = {},
  ): Promise<WorkItemDetail> {
    const project = options.project || this.defaultProject;
    const rel = LINK_TYPE_TO_REL[linkType];

    const current = await this.request<WorkItemResponse>(
      `wit/workitems/${fromId}?$expand=relations`,
      {
        project,
        useProjectScope: !!project,
        apiVersion: RELATIONS_API_VERSION,
      },
    );

    const relations = current.relations ?? [];
    const index = relations.findIndex(
      (r) => r.rel === rel && extractWorkItemIdFromUrl(r.url) === toId,
    );

    if (index === -1) {
      throw new ValidationError(
        `No ${linkType} link from #${fromId} to #${toId} found (rel=${rel}).`,
      );
    }

    const patchDoc = [
      { op: "test" as const, path: "/rev", value: current.rev },
      { op: "remove" as const, path: `/relations/${index}` },
    ];

    const raw = await this.request<WorkItemResponse>(`wit/workitems/${fromId}`, {
      method: "PATCH",
      body: patchDoc,
      contentType: "application/json-patch+json",
      project,
      useProjectScope: !!project,
      apiVersion: RELATIONS_API_VERSION,
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
