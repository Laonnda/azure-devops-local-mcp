/**
 * Auth provider selection logic.
 * Reads environment variables and returns the appropriate AuthProvider.
 * Throws AuthenticationError (rather than process.exit) so the caller
 * decides how to surface failures.
 */

import { ManagedIdentityAuthProvider } from "./managed-identity.js";
import { OAuthAuthProvider } from "./oauth.js";
import { PatAuthProvider } from "./pat.js";
import type { AuthProvider } from "./types.js";
import { AuthenticationError } from "../utils/errors.js";

export interface AuthEnv {
  ADO_PAT?: string;
  ADO_CLIENT_ID?: string;
  ADO_CLIENT_SECRET?: string;
  ADO_TENANT_ID?: string;
  ADO_USE_MANAGED_IDENTITY?: string;
  ADO_MI_CLIENT_ID?: string;
}

/**
 * Selects and constructs the correct AuthProvider from environment variables.
 *
 * Priority (only one method may be active at a time):
 *   1. ADO_PAT                    → PatAuthProvider
 *   2. ADO_CLIENT_ID              → OAuthAuthProvider (requires SECRET + TENANT_ID)
 *   3. ADO_USE_MANAGED_IDENTITY   → ManagedIdentityAuthProvider
 *
 * @throws AuthenticationError when no method is configured or when multiple are.
 */
export function selectAuthProvider(env: AuthEnv): AuthProvider {
  const hasPat = Boolean(env.ADO_PAT);
  const hasOAuth = Boolean(env.ADO_CLIENT_ID);
  const hasManagedIdentity = env.ADO_USE_MANAGED_IDENTITY === "true";

  const activeCount = [hasPat, hasOAuth, hasManagedIdentity].filter(Boolean).length;

  if (activeCount > 1) {
    throw new AuthenticationError(
      "Multiple authentication methods configured. " +
        "Set exactly one of: ADO_PAT, ADO_CLIENT_ID, or ADO_USE_MANAGED_IDENTITY=true",
    );
  }

  if (hasPat) {
    return new PatAuthProvider(env.ADO_PAT!);
  }

  if (hasOAuth) {
    const clientSecret = env.ADO_CLIENT_SECRET;
    const tenantId = env.ADO_TENANT_ID;
    if (!clientSecret || !tenantId) {
      throw new AuthenticationError(
        "OAuth 2.0 requires ADO_CLIENT_ID, ADO_CLIENT_SECRET, and ADO_TENANT_ID to all be set",
      );
    }
    return new OAuthAuthProvider(env.ADO_CLIENT_ID!, clientSecret, tenantId);
  }

  if (hasManagedIdentity) {
    return new ManagedIdentityAuthProvider(env.ADO_MI_CLIENT_ID);
  }

  throw new AuthenticationError(
    "No authentication method configured. Set one of:\n" +
      "  ADO_PAT=<token>                                        (Personal Access Token)\n" +
      "  ADO_CLIENT_ID + ADO_CLIENT_SECRET + ADO_TENANT_ID     (OAuth 2.0)\n" +
      "  ADO_USE_MANAGED_IDENTITY=true                          (Azure Managed Identity)",
  );
}
