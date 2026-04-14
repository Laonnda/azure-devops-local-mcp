import { describe, it, expect } from "vitest";
import { selectAuthProvider } from "../../../src/auth/select.js";
import { PatAuthProvider } from "../../../src/auth/pat.js";
import { OAuthAuthProvider } from "../../../src/auth/oauth.js";
import { ManagedIdentityAuthProvider } from "../../../src/auth/managed-identity.js";
import { AuthenticationError } from "../../../src/utils/errors.js";

describe("selectAuthProvider", () => {
  // ---------------------------------------------------------------------------
  // PAT
  // ---------------------------------------------------------------------------

  it("returns PatAuthProvider when ADO_PAT is set", () => {
    const provider = selectAuthProvider({ ADO_PAT: "my-pat-token-12345678901234567890123456789" });
    expect(provider).toBeInstanceOf(PatAuthProvider);
  });

  // ---------------------------------------------------------------------------
  // OAuth 2.0
  // ---------------------------------------------------------------------------

  it("returns OAuthAuthProvider when ADO_CLIENT_ID is set with all required vars", () => {
    const provider = selectAuthProvider({
      ADO_CLIENT_ID: "client-id",
      ADO_CLIENT_SECRET: "client-secret",
      ADO_TENANT_ID: "tenant-id",
    });
    expect(provider).toBeInstanceOf(OAuthAuthProvider);
  });

  it("throws AuthenticationError when ADO_CLIENT_ID is set but ADO_CLIENT_SECRET is missing", () => {
    expect(() =>
      selectAuthProvider({ ADO_CLIENT_ID: "client-id", ADO_TENANT_ID: "tenant-id" }),
    ).toThrow(AuthenticationError);
  });

  it("throws AuthenticationError when ADO_CLIENT_ID is set but ADO_TENANT_ID is missing", () => {
    expect(() =>
      selectAuthProvider({ ADO_CLIENT_ID: "client-id", ADO_CLIENT_SECRET: "secret" }),
    ).toThrow(AuthenticationError);
  });

  it("throws AuthenticationError when ADO_CLIENT_ID is set but both secret and tenant are missing", () => {
    expect(() => selectAuthProvider({ ADO_CLIENT_ID: "client-id" })).toThrow(AuthenticationError);
  });

  // ---------------------------------------------------------------------------
  // Managed Identity
  // ---------------------------------------------------------------------------

  it("returns ManagedIdentityAuthProvider when ADO_USE_MANAGED_IDENTITY is 'true'", () => {
    const provider = selectAuthProvider({ ADO_USE_MANAGED_IDENTITY: "true" });
    expect(provider).toBeInstanceOf(ManagedIdentityAuthProvider);
  });

  it("returns ManagedIdentityAuthProvider with clientId when ADO_MI_CLIENT_ID is set", () => {
    const provider = selectAuthProvider({
      ADO_USE_MANAGED_IDENTITY: "true",
      ADO_MI_CLIENT_ID: "user-assigned-id",
    });
    expect(provider).toBeInstanceOf(ManagedIdentityAuthProvider);
  });

  it("does not activate Managed Identity when ADO_USE_MANAGED_IDENTITY is 'false'", () => {
    expect(() => selectAuthProvider({ ADO_USE_MANAGED_IDENTITY: "false" })).toThrow(
      AuthenticationError,
    );
  });

  it("does not activate Managed Identity when ADO_USE_MANAGED_IDENTITY is an empty string", () => {
    expect(() => selectAuthProvider({ ADO_USE_MANAGED_IDENTITY: "" })).toThrow(AuthenticationError);
  });

  // ---------------------------------------------------------------------------
  // No auth method configured
  // ---------------------------------------------------------------------------

  it("throws AuthenticationError when no auth vars are set", () => {
    expect(() => selectAuthProvider({})).toThrow(AuthenticationError);
  });

  it("error message lists all available auth methods", () => {
    let message = "";
    try {
      selectAuthProvider({});
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/ADO_PAT/);
    expect(message).toMatch(/ADO_CLIENT_ID/);
    expect(message).toMatch(/ADO_USE_MANAGED_IDENTITY/);
  });

  // ---------------------------------------------------------------------------
  // Ambiguous configuration (multiple methods set)
  // ---------------------------------------------------------------------------

  it("throws AuthenticationError when both ADO_PAT and ADO_CLIENT_ID are set", () => {
    expect(() =>
      selectAuthProvider({
        ADO_PAT: "some-pat",
        ADO_CLIENT_ID: "client-id",
        ADO_CLIENT_SECRET: "secret",
        ADO_TENANT_ID: "tenant-id",
      }),
    ).toThrow(AuthenticationError);
  });

  it("throws AuthenticationError when both ADO_PAT and ADO_USE_MANAGED_IDENTITY are set", () => {
    expect(() =>
      selectAuthProvider({ ADO_PAT: "some-pat", ADO_USE_MANAGED_IDENTITY: "true" }),
    ).toThrow(AuthenticationError);
  });

  it("throws AuthenticationError when both ADO_CLIENT_ID and ADO_USE_MANAGED_IDENTITY are set", () => {
    expect(() =>
      selectAuthProvider({
        ADO_CLIENT_ID: "client-id",
        ADO_CLIENT_SECRET: "secret",
        ADO_TENANT_ID: "tenant-id",
        ADO_USE_MANAGED_IDENTITY: "true",
      }),
    ).toThrow(AuthenticationError);
  });

  it("ambiguity error message mentions the conflict", () => {
    let message = "";
    try {
      selectAuthProvider({ ADO_PAT: "some-pat", ADO_USE_MANAGED_IDENTITY: "true" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/multiple/i);
  });
});
