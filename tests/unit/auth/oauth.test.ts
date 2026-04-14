import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OAuthAuthProvider } from "../../../src/auth/oauth.js";
import { AuthenticationError } from "../../../src/utils/errors.js";

const VALID_CLIENT_ID = "test-client-id";
const VALID_CLIENT_SECRET = "test-client-secret";
const VALID_TENANT_ID = "test-tenant-id";

function makeProvider(
  clientId = VALID_CLIENT_ID,
  clientSecret = VALID_CLIENT_SECRET,
  tenantId = VALID_TENANT_ID,
) {
  return new OAuthAuthProvider(clientId, clientSecret, tenantId);
}

function makeTokenResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    access_token: "access-token-abc",
    refresh_token: "refresh-token-xyz",
    expires_in: 3600,
    token_type: "Bearer",
    ...overrides,
  };
}

describe("OAuthAuthProvider", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  // ---------------------------------------------------------------------------
  // Constructor validation
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("throws AuthenticationError when clientId is empty", () => {
      expect(() => makeProvider("", VALID_CLIENT_SECRET, VALID_TENANT_ID)).toThrow(
        AuthenticationError,
      );
    });

    it("throws AuthenticationError when clientSecret is empty", () => {
      expect(() => makeProvider(VALID_CLIENT_ID, "", VALID_TENANT_ID)).toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when tenantId is empty", () => {
      expect(() => makeProvider(VALID_CLIENT_ID, VALID_CLIENT_SECRET, "")).toThrow(
        AuthenticationError,
      );
    });

    it("throws AuthenticationError when clientId is whitespace only", () => {
      expect(() => makeProvider("   ", VALID_CLIENT_SECRET, VALID_TENANT_ID)).toThrow(
        AuthenticationError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Authorization URL generation
  // ---------------------------------------------------------------------------

  describe("getAuthorizationUrl", () => {
    it("returns a valid Azure AD authorization URL", () => {
      const provider = makeProvider();
      const url = provider.getAuthorizationUrl();
      expect(url).toContain(`login.microsoftonline.com/${VALID_TENANT_ID}/oauth2/v2.0/authorize`);
      expect(url).toContain(`client_id=${VALID_CLIENT_ID}`);
      expect(url).toContain("response_type=code");
      expect(url).toContain("499b84ac-1321-427f-aa17-267ca6975798");
    });

    it("uses the provided redirect URI", () => {
      const provider = makeProvider();
      const url = provider.getAuthorizationUrl("https://myapp.example.com/callback");
      expect(url).toContain("redirect_uri=https%3A%2F%2Fmyapp.example.com%2Fcallback");
    });
  });

  // ---------------------------------------------------------------------------
  // Authorization code exchange
  // ---------------------------------------------------------------------------

  describe("getAuthHeader — auth code exchange", () => {
    it("exchanges ADO_AUTH_CODE for a Bearer token on first call", async () => {
      process.env.ADO_AUTH_CODE = "my-auth-code";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeTokenResponse()),
      });

      const provider = makeProvider();
      const header = await provider.getAuthHeader();

      expect(header).toBe("Bearer access-token-abc");
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toContain(`login.microsoftonline.com/${VALID_TENANT_ID}/oauth2/v2.0/token`);
      expect(options.method).toBe("POST");
      expect(String(options.body)).toContain("grant_type=authorization_code");
      expect(String(options.body)).toContain("code=my-auth-code");
    });

    it("throws AuthenticationError when ADO_AUTH_CODE is not set and no cached token", async () => {
      delete process.env.ADO_AUTH_CODE;
      const provider = makeProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when token endpoint returns non-OK status", async () => {
      process.env.ADO_AUTH_CODE = "bad-code";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "invalid_grant" }),
      });

      const provider = makeProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when token endpoint returns invalid JSON", async () => {
      process.env.ADO_AUTH_CODE = "my-auth-code";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      });

      const provider = makeProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when token response is missing access_token", async () => {
      process.env.ADO_AUTH_CODE = "my-auth-code";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ expires_in: 3600 }), // missing access_token
      });

      const provider = makeProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError on network error", async () => {
      process.env.ADO_AUTH_CODE = "my-auth-code";
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      const provider = makeProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Token caching
  // ---------------------------------------------------------------------------

  describe("token caching", () => {
    it("returns cached token without making a second network call", async () => {
      process.env.ADO_AUTH_CODE = "my-auth-code";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeTokenResponse({ expires_in: 3600 })),
      });

      const provider = makeProvider();
      await provider.getAuthHeader();
      await provider.getAuthHeader();

      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });

    it("re-fetches token when the cache has expired", async () => {
      process.env.ADO_AUTH_CODE = "my-auth-code";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            makeTokenResponse({
              expires_in: 0, // already expired
              refresh_token: undefined,
            }),
          ),
      });

      const provider = makeProvider();
      await provider.getAuthHeader();

      // Second call — cache is expired and there is no refresh token, so it
      // should try the auth code again (same code env var is set).
      await provider.getAuthHeader();

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Token refresh
  // ---------------------------------------------------------------------------

  describe("token refresh", () => {
    it("uses refresh_token when access token is near expiry", async () => {
      process.env.ADO_AUTH_CODE = "initial-code";

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Initial exchange — return token that expires in 25s (within the 30s buffer)
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve(
                makeTokenResponse({
                  access_token: "first-access-token",
                  refresh_token: "my-refresh-token",
                  expires_in: 25,
                }),
              ),
          });
        }
        // Refresh call
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              makeTokenResponse({
                access_token: "refreshed-access-token",
                expires_in: 3600,
              }),
            ),
        });
      });

      const provider = makeProvider();
      // First call: exchange auth code, token is within buffer zone
      await provider.getAuthHeader();
      // Second call: should trigger refresh because token is within the 30s buffer
      const header = await provider.getAuthHeader();

      expect(header).toBe("Bearer refreshed-access-token");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      // Verify second call used refresh_token grant
      const body = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=my-refresh-token");
    });

    it("falls back to auth code re-exchange when refresh_token is rejected", async () => {
      process.env.ADO_AUTH_CODE = "auth-code";

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Initial exchange — near-expiry token with refresh token
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve(
                makeTokenResponse({
                  expires_in: 25,
                  refresh_token: "expired-refresh-token",
                }),
              ),
          });
        }
        if (callCount === 2) {
          // Refresh fails
          return Promise.resolve({ ok: false, status: 400 });
        }
        // Auth code re-exchange succeeds
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              makeTokenResponse({
                access_token: "new-access-token",
                expires_in: 3600,
              }),
            ),
        });
      });

      const provider = makeProvider();
      await provider.getAuthHeader();
      const header = await provider.getAuthHeader();

      expect(header).toBe("Bearer new-access-token");
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
