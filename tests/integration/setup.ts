/**
 * Shared setup for integration tests.
 *
 * Required environment variables:
 *   ADO_ORG_URL   — e.g. https://dev.azure.com/myorg
 *   ADO_PAT       — Personal Access Token with appropriate scopes
 *   ADO_TEST_PROJECT — project to run tests against (default: first project found)
 *
 * PAT scopes needed to run all integration tests:
 *   Work Items — Read & Write
 *   Code — Read
 *   Build — Read
 *   Wiki — Read
 */

import { RateLimiter } from "../../src/utils/rate-limiter.js";
import { PatAuthProvider } from "../../src/auth/pat.js";
import type { AdoConfig } from "../../src/auth/types.js";

export const HAS_PAT = Boolean(process.env.ADO_PAT && process.env.ADO_ORG_URL);

export function createIntegrationConfig(): AdoConfig {
  const orgUrl = process.env.ADO_ORG_URL;
  const pat = process.env.ADO_PAT;
  if (!orgUrl || !pat) {
    throw new Error("ADO_ORG_URL and ADO_PAT must be set for integration tests");
  }
  return {
    orgUrl,
    defaultProject: process.env.ADO_TEST_PROJECT,
    auth: new PatAuthProvider(pat),
    rateLimiter: new RateLimiter(30), // conservative for tests
  };
}
