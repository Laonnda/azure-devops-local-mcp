/**
 * Azure DevOps Search API client.
 * PAT scope required: vso.code (read)
 */

import type { AdoConfig } from "../auth/types.js";
import { BaseClient } from "./base-client.js";

export interface CodeSearchResult {
  fileName: string;
  path: string;
  repository: { name: string; id: string };
  project: { name: string };
  matches: { content: string; charOffset: number; length: number }[];
}

interface SearchResponse {
  count: number;
  results: {
    fileName: string;
    path: string;
    repository: { name: string; id: string };
    project: { name: string };
    matches: {
      content?: { text: string; charOffset: number; length: number }[];
    };
  }[];
}

export class SearchClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
  }

  protected override get orgUrl(): string {
    return super.orgUrl.replace("dev.azure.com", "almsearch.dev.azure.com");
  }

  async searchCode(
    searchText: string,
    options: { project?: string; repositoryName?: string; top?: number } = {},
  ): Promise<{ results: CodeSearchResult[]; count: number }> {
    const filters: Record<string, string[]> = {};
    if (options.project) {
      filters.Project = [options.project];
    }
    if (options.repositoryName) {
      filters.Repository = [options.repositoryName];
    }

    const response = await this.request<SearchResponse>("search/codesearchresults", {
      method: "POST",
      body: {
        searchText,
        $top: options.top || 25,
        filters,
      },
      useProjectScope: false,
    });

    return {
      results: response.results.map((r) => ({
        fileName: r.fileName,
        path: r.path,
        repository: r.repository,
        project: r.project,
        matches:
          r.matches?.content?.map((m) => ({
            content: m.text,
            charOffset: m.charOffset,
            length: m.length,
          })) || [],
      })),
      count: response.count,
    };
  }
}
