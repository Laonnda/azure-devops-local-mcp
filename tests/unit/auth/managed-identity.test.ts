import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ManagedIdentityAuthProvider } from "../../../src/auth/managed-identity.js";
import { AuthenticationError } from "../../../src/utils/errors.js";

function makeImdsResponse(overrides: Partial<Record<string, unknown>> = {}) {
  // expires_on is a Unix timestamp (seconds) in the future
  const expiresOnSeconds = Math.floor(Date.now() / 1_000) + 3600;
  return {
    access_token: "imds-access-token",
    expires_on: String(expiresOnSeconds),
    token_type: "Bearer",
    ...overrides,
  };
}

describe("ManagedIdentityAuthProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------------------------------------------------------------------------
  // Successful token acquisition
  // ---------------------------------------------------------------------------

  describe("getAuthHeader — system-assigned identity", () => {
    it("returns a Bearer token from IMDS", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeImdsResponse()),
      });

      const provider = new ManagedIdentityAuthProvider();
      const header = await provider.getAuthHeader();

      expect(header).toBe("Bearer imds-access-token");
    });

    it("calls the correct IMDS endpoint with Metadata header", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeImdsResponse()),
      });

      const provider = new ManagedIdentityAuthProvider();
      await provider.getAuthHeader();

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toContain("169.254.169.254/metadata/identity/oauth2/token");
      expect(url).toContain("api-version=2018-02-01");
      expect(url).toContain("resource=499b84ac-1321-427f-aa17-267ca6975798");
      expect(url).not.toContain("client_id");
      expect((options.headers as Record<string, string>).Metadata).toBe("true");
    });
  });

  describe("getAuthHeader — user-assigned identity", () => {
    it("includes client_id in the IMDS request when provided", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeImdsResponse()),
      });

      const provider = new ManagedIdentityAuthProvider("my-user-assigned-client-id");
      await provider.getAuthHeader();

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(url).toContain("client_id=my-user-assigned-client-id");
    });
  });

  // ---------------------------------------------------------------------------
  // Token caching
  // ---------------------------------------------------------------------------

  describe("token caching", () => {
    it("returns cached token without making a second network call", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeImdsResponse()),
      });

      const provider = new ManagedIdentityAuthProvider();
      await provider.getAuthHeader();
      await provider.getAuthHeader();

      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });

    it("re-fetches when token has expired", async () => {
      // Return an already-expired token (expires_on in the past)
      const expiredSeconds = Math.floor(Date.now() / 1_000) - 10;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeImdsResponse({ expires_on: String(expiredSeconds) })),
      });

      const provider = new ManagedIdentityAuthProvider();
      await provider.getAuthHeader();
      await provider.getAuthHeader();

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws AuthenticationError on IMDS timeout (non-Azure environment)", async () => {
      const timeoutError = new Error("The operation was aborted");
      timeoutError.name = "TimeoutError";
      globalThis.fetch = vi.fn().mockRejectedValue(timeoutError);

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
      await expect(provider.getAuthHeader()).rejects.toThrow(/timed out/i);
    });

    it("throws AuthenticationError on AbortError (non-Azure environment)", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError on HTTP 400 (identity not configured)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "identity_not_found" }),
      });

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
      await expect(provider.getAuthHeader()).rejects.toThrow(/not configured/i);
    });

    it("throws AuthenticationError on other non-OK HTTP status", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "internal_error" }),
      });

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when IMDS returns invalid JSON", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      });

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when IMDS response is missing access_token", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ expires_on: String(Math.floor(Date.now() / 1000) + 3600) }),
      });

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError when expires_on is not a valid number", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "some-token", expires_on: "not-a-number" }),
      });

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError on general network failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network unreachable"));

      const provider = new ManagedIdentityAuthProvider();
      await expect(provider.getAuthHeader()).rejects.toThrow(AuthenticationError);
    });
  });
});
