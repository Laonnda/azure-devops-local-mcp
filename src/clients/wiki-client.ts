/**
 * Azure DevOps Wiki API client.
 * PAT scope required: vso.wiki (read), vso.wiki_write (write)
 */

import type { AdoConfig } from "../auth/types.js";
import { BaseClient } from "./base-client.js";

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

export class WikiClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
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
