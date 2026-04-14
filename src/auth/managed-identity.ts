/**
 * Azure Managed Identity authentication provider.
 * Acquires tokens from the Azure Instance Metadata Service (IMDS).
 *
 * Only available in Azure-hosted environments:
 *   Virtual Machines, App Service, Azure Functions, AKS, Container Apps, etc.
 *
 * Identity types:
 *   System-assigned  — Set ADO_USE_MANAGED_IDENTITY=true (no client ID needed)
 *   User-assigned    — Also set ADO_MI_CLIENT_ID=<client-id>
 */

import type { AuthProvider } from "./types.js";
import { AuthenticationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const IMDS_ENDPOINT = "http://169.254.169.254/metadata/identity/oauth2/token";
const IMDS_API_VERSION = "2018-02-01";
// Azure DevOps resource / application ID
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
// Refresh 30 s before actual expiry
const TOKEN_REFRESH_BUFFER_MS = 30_000;
// Short timeout so the server fails fast when not running in Azure
const IMDS_TIMEOUT_MS = 5_000;

interface ImdsTokenResponse {
  access_token: string;
  /** Unix timestamp (seconds) as a string */
  expires_on: string;
  token_type: string;
}

interface CachedToken {
  accessToken: string;
  /** Absolute expiry in milliseconds (Date.now() epoch) */
  expiresAt: number;
}

export class ManagedIdentityAuthProvider implements AuthProvider {
  private readonly clientId?: string;
  private cache: CachedToken | null = null;

  /**
   * @param clientId Optional client ID for user-assigned managed identities.
   *                 Leave undefined for system-assigned identities.
   */
  constructor(clientId?: string) {
    this.clientId = clientId;
  }

  async getAuthHeader(): Promise<string> {
    const token = await this.getValidToken();
    return `Bearer ${token}`;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async getValidToken(): Promise<string> {
    if (this.cache && this.cache.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
      return this.cache.accessToken;
    }

    await this.fetchToken();
    return this.cache!.accessToken;
  }

  private async fetchToken(): Promise<void> {
    const params = new URLSearchParams({
      "api-version": IMDS_API_VERSION,
      resource: ADO_RESOURCE,
    });

    if (this.clientId) {
      params.set("client_id", this.clientId);
    }

    const url = `${IMDS_ENDPOINT}?${params}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Metadata: "true" },
        signal: AbortSignal.timeout(IMDS_TIMEOUT_MS),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (isTimeout) {
        throw new AuthenticationError(
          "Managed Identity IMDS endpoint timed out. " +
            "Ensure this process is running in an Azure-hosted environment " +
            "(VM, App Service, Functions, AKS, etc.) with a managed identity assigned.",
        );
      }
      throw new AuthenticationError(
        `Managed Identity token request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      logger.warn("IMDS token endpoint returned an error", { status: response.status });
      if (response.status === 400) {
        throw new AuthenticationError(
          "Managed Identity is not configured on this Azure resource. " +
            "Enable a system-assigned identity in the Azure portal, " +
            "or set ADO_MI_CLIENT_ID for a user-assigned identity.",
        );
      }
      throw new AuthenticationError(
        `Managed Identity token request failed (HTTP ${response.status})`,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new AuthenticationError("IMDS token response was not valid JSON");
    }

    if (!isImdsTokenResponse(data)) {
      throw new AuthenticationError("IMDS token response is missing required fields");
    }

    const expiresAtSeconds = parseInt(data.expires_on, 10);
    if (isNaN(expiresAtSeconds)) {
      throw new AuthenticationError("IMDS token response contains an invalid expiry timestamp");
    }

    this.cache = {
      accessToken: data.access_token,
      expiresAt: expiresAtSeconds * 1_000,
    };

    logger.info("Managed Identity token acquired successfully");
  }
}

function isImdsTokenResponse(data: unknown): data is ImdsTokenResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "access_token" in data &&
    typeof (data as Record<string, unknown>).access_token === "string" &&
    "expires_on" in data &&
    typeof (data as Record<string, unknown>).expires_on === "string"
  );
}
