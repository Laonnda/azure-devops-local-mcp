/**
 * Base HTTP client for Azure DevOps REST API.
 * Handles auth headers, API versioning, error parsing, rate limiting, and retries.
 */

import type { AdoConfig } from "../auth/types.js";
import { parseAdoErrorResponse, RateLimitError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import { sanitizeObject } from "../utils/sanitize.js";

const DEFAULT_API_VERSION = "7.2-preview";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

interface RequestOptions {
  method?: string;
  body?: unknown;
  contentType?: string;
  project?: string;
  useProjectScope?: boolean;
  timeoutMs?: number;
  apiVersion?: string;
  /** Additional HTTP headers merged into the request (e.g. If-Match for optimistic concurrency). */
  extraHeaders?: Record<string, string>;
}

export class BaseClient {
  private readonly config: AdoConfig;
  private readonly rateLimiter: RateLimiter;

  constructor(config: AdoConfig) {
    this.config = config;
    this.rateLimiter = config.rateLimiter;
  }

  protected get orgUrl(): string {
    return this.config.orgUrl.replace(/\/+$/, "");
  }

  protected get defaultProject(): string | undefined {
    return this.config.defaultProject;
  }

  protected resolveProject(project?: string): string {
    const resolved = project || this.defaultProject;
    if (!resolved) {
      throw new Error("Project is required. Provide it as a parameter or set ADO_DEFAULT_PROJECT.");
    }
    return resolved;
  }

  /**
   * Make an authenticated request to the Azure DevOps API.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body } = await this._request<T>(path, options);
    return body;
  }

  /**
   * Like request(), but also returns the ETag response header.
   * Used by clients that need the ETag for optimistic concurrency (e.g. wiki PUT).
   */
  protected async requestFull<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ body: T; etag: string | null }> {
    return this._request<T>(path, options);
  }

  private async _request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ body: T; etag: string | null }> {
    const {
      method = "GET",
      body,
      contentType = "application/json",
      project,
      useProjectScope = true,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      apiVersion = this.config.apiVersion ?? DEFAULT_API_VERSION,
      extraHeaders,
    } = options;

    let basePath: string;
    if (useProjectScope && project) {
      basePath = `${this.orgUrl}/${encodeURIComponent(project)}/_apis`;
    } else {
      basePath = `${this.orgUrl}/_apis`;
    }

    const separator = path.includes("?") ? "&" : "?";
    const url = `${basePath}/${path}${separator}api-version=${apiVersion}`;

    const authHeader = await this.config.auth.getAuthHeader();

    const headers: Record<string, string> = {
      Authorization: authHeader,
      Accept: "application/json",
      ...extraHeaders,
    };

    if (body) {
      headers["Content-Type"] = contentType;
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.rateLimiter.acquire();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        logger.debug(`${method} ${url}`, { attempt });

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const parsedSec = retryAfter ? parseInt(retryAfter, 10) : NaN;
          // Cap at 60s; fall back to linear backoff on missing/HTTP-date Retry-After
          const retryMs = Number.isFinite(parsedSec)
            ? Math.min(Math.max(parsedSec, 1), 60) * 1000
            : 5000 * (attempt + 1);
          logger.warn(`Rate limited, retrying after ${retryMs}ms`, { attempt });
          await this.rateLimiter.backoff(retryMs);
          lastError = new RateLimitError(retryMs);
          continue;
        }

        if (response.status === 503 && attempt < MAX_RETRIES) {
          const waitMs = 1000 * Math.pow(2, attempt);
          logger.warn(`Service unavailable, retrying after ${waitMs}ms`, { attempt });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (!response.ok) {
          let errorBody: unknown;
          try {
            errorBody = await response.json();
          } catch {
            errorBody = { message: await response.text() };
          }
          throw parseAdoErrorResponse(errorBody, response.status);
        }

        // Handle 204 No Content
        if (response.status === 204) {
          return { body: undefined as T, etag: null };
        }

        const etag = response.headers?.get("ETag") ?? null;
        const data = await response.json();
        return { body: sanitizeObject(data) as T, etag };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`Request timed out after ${timeoutMs}ms`);
          if (attempt < MAX_RETRIES) continue;
        }
        if (error instanceof RateLimitError) {
          lastError = error;
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error("Max retries exceeded");
  }
}
