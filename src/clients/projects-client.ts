/**
 * Azure DevOps Projects API client.
 */

import type { AdoConfig } from "../auth/types.js";
import { BaseClient } from "./base-client.js";

export interface AdoProject {
  id: string;
  name: string;
  description: string;
  state: string;
  url: string;
  lastUpdateTime: string;
}

interface ProjectsListResponse {
  value: AdoProject[];
  count: number;
}

export class ProjectsClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
  }

  async list(options: { top?: number; skip?: number } = {}): Promise<{
    projects: AdoProject[];
    count: number;
  }> {
    const params = new URLSearchParams();
    if (options.top) params.set("$top", String(options.top));
    if (options.skip) params.set("$skip", String(options.skip));

    const query = params.toString();
    const path = query ? `projects?${query}` : "projects";

    const response = await this.request<ProjectsListResponse>(path, {
      useProjectScope: false,
    });

    return {
      projects: response.value.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
        state: p.state,
        url: p.url,
        lastUpdateTime: p.lastUpdateTime,
      })),
      count: response.count,
    };
  }
}
