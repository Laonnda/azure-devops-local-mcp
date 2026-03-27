/**
 * Error types for the ADO MCP server.
 * All errors strip credentials before surfacing messages.
 */

import { sanitizeString } from "./sanitize.js";

export class AdoMcpError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(sanitizeString(message));
    this.name = "AdoMcpError";
    this.statusCode = statusCode;
  }
}

export class AuthenticationError extends AdoMcpError {
  constructor(message = "Authentication failed. Check your PAT and organization URL.") {
    super(message, 401);
    this.name = "AuthenticationError";
  }
}

export class NotFoundError extends AdoMcpError {
  constructor(resource: string) {
    super(`Resource not found: ${resource}`, 404);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AdoMcpError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Rate limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`, 429);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ValidationError extends AdoMcpError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export function parseAdoErrorResponse(body: unknown, statusCode: number): AdoMcpError {
  if (statusCode === 401 || statusCode === 403) {
    return new AuthenticationError();
  }

  let message = `Azure DevOps API error (HTTP ${statusCode})`;

  if (body && typeof body === "object" && "message" in body) {
    message = String((body as { message: string }).message);
  }

  if (statusCode === 404) {
    return new NotFoundError(message);
  }

  return new AdoMcpError(message, statusCode);
}
