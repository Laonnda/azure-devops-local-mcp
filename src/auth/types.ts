/**
 * Authentication provider interface.
 */

import type { RateLimiter } from "../utils/rate-limiter.js";

export interface AuthProvider {
  getAuthHeader(): Promise<string>;
}

export interface AdoConfig {
  orgUrl: string;
  defaultProject?: string;
  auth: AuthProvider;
  rateLimiter: RateLimiter;
  apiVersion?: string;
  /** When true, only tools annotated readOnlyHint: true are registered. */
  readOnly?: boolean;
}
