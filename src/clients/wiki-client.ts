/**
 * Azure DevOps Wiki API client.
 * PAT scope required: vso.wiki (read), vso.wiki_write (write)
 */

import type { AdoConfig } from "../auth/types.js";
import { BaseClient } from "./base-client.js";
import { ValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface WikiPage {
  path: string;
  url: string;
  content: string;
  lastUpdatedDate: string;
  version: number;
}

export interface WikiPagesResponse {
  pages: WikiPage[];
  count: number;
}

interface RawWikiPage {
  path: string;
  url: string;
  content?: string;
  lastUpdatedDate?: string;
  gitItemPath?: string;
  versions?: { version: string }[];
  version?: number;
}

interface RawWikiPagesResponse {
  value: RawWikiPage[];
  count: number;
}

export interface Wiki {
  id: string;
  name: string;
  type: "projectWiki" | "codeWiki";
  projectId: string;
  remoteUrl: string;
  versions: string[];
}

interface RawWiki {
  id: string;
  name: string;
  type: "projectWiki" | "codeWiki";
  projectId: string;
  remoteUrl?: string;
  versions?: { version: string }[];
}

interface RawWikisResponse {
  value: RawWiki[];
  count: number;
}

export class WikiClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
  }

  /**
   * List wikis in a project, or all wikis in the org when project is omitted.
   */
  async listWikis(project?: string): Promise<{ wikis: Wiki[]; count: number }> {
    const response = await this.request<RawWikisResponse>("wiki/wikis", { project });
    return {
      wikis: response.value.map(mapWiki),
      count: response.count,
    };
  }

  /**
   * Resolve the projectWiki id for a given project.
   * Throws ValidationError if no projectWiki exists (listing available codeWikis in the message).
   */
  async resolveProjectWikiId(project: string): Promise<string> {
    if (!project) {
      throw new ValidationError("project is required when wikiId is not provided");
    }
    const { wikis } = await this.listWikis(project);
    const projectWikis = wikis.filter((w) => w.type === "projectWiki");
    const codeWikis = wikis.filter((w) => w.type === "codeWiki");

    if (projectWikis.length === 0) {
      if (codeWikis.length > 0) {
        const names = codeWikis.map((w) => w.name).join(", ");
        throw new ValidationError(
          `No projectWiki found for "${project}". Available codeWikis: ${names}. Retry with an explicit wikiId.`,
        );
      }
      throw new ValidationError(`No wikis found for project "${project}".`);
    }

    if (projectWikis.length > 1) {
      logger.warn("Multiple projectWikis found; using the first", { project });
    }

    return projectWikis[0].id;
  }

  /**
   * Get a single wiki page by path.
   * @param project - Azure DevOps project name
   * @param wikiId - Wiki ID (GUID) or wiki name
   * @param path - Wiki page path (e.g. /MyPage)
   */
  async getPage(project: string, wikiId: string, path: string): Promise<WikiPage> {
    const params = new URLSearchParams({ path, includeContent: "true" });
    const raw = await this.request<RawWikiPage>(
      `wiki/wikis/${encodeURIComponent(wikiId)}/pages?${params.toString()}`,
      { project },
    );
    return mapWikiPage(raw);
  }

  /**
   * List pages in a wiki.
   * @param project - Azure DevOps project name
   * @param wikiId - Wiki ID (GUID) or wiki name
   * @param options - Pagination options
   */
  async listPages(
    project: string,
    wikiId: string,
    options: { top?: number; skip?: number } = {},
  ): Promise<WikiPagesResponse> {
    const params = new URLSearchParams();
    if (options.top !== undefined) {
      params.set("$top", String(options.top));
    }
    if (options.skip !== undefined) {
      params.set("$skip", String(options.skip));
    }

    const query = params.toString();
    const path = query
      ? `wiki/wikis/${encodeURIComponent(wikiId)}/pages?${query}`
      : `wiki/wikis/${encodeURIComponent(wikiId)}/pages`;

    const response = await this.request<RawWikiPagesResponse>(path, { project });

    return {
      pages: response.value.map(mapWikiPage),
      count: response.count,
    };
  }

  /**
   * Update (or create) a wiki page.
   * @param project - Azure DevOps project name
   * @param wikiId - Wiki ID (GUID) or wiki name
   * @param path - Wiki page path (e.g. /MyPage)
   * @param content - Markdown content for the page
   * @param message - Optional commit message
   */
  async updatePage(
    project: string,
    wikiId: string,
    path: string,
    content: string,
    message?: string,
  ): Promise<WikiPage> {
    const params = new URLSearchParams({ path });
    const body: Record<string, unknown> = { content };
    if (message) {
      body.gitVersionDescriptor = { commitMessage: message };
    }

    const raw = await this.request<RawWikiPage>(
      `wiki/wikis/${encodeURIComponent(wikiId)}/pages?${params.toString()}`,
      {
        method: "PUT",
        body,
        project,
      },
    );
    return mapWikiPage(raw);
  }
}

function mapWikiPage(raw: RawWikiPage): WikiPage {
  return {
    path: raw.path,
    url: raw.url,
    content: raw.content ?? "",
    lastUpdatedDate: raw.lastUpdatedDate ?? "",
    version: raw.version ?? 0,
  };
}

function mapWiki(raw: RawWiki): Wiki {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    projectId: raw.projectId,
    remoteUrl: raw.remoteUrl ?? "",
    versions: raw.versions?.map((v) => v.version) ?? [],
  };
}
