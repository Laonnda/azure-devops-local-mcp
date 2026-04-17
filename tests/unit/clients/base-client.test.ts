import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BaseClient } from "../../../src/clients/base-client.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { AuthenticationError, NotFoundError } from "../../../src/utils/errors.js";

// Create a testable subclass since BaseClient.request is protected
class TestClient extends BaseClient {
  async testRequest<T>(path: string, options = {}): Promise<T> {
    return this.request<T>(path, options);
  }
}

function createConfig(): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: {
      getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0"),
    },
    rateLimiter: new RateLimiter(60),
  };
}

describe("BaseClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("makes authenticated GET requests with correct URL", async () => {
    const mockResponse = { value: [{ id: 1 }], count: 1 };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const client = new TestClient(createConfig());
    const result = await client.testRequest("wit/workitems/1", {
      project: "MyProject",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://dev.azure.com/testorg/MyProject/_apis/wit/workitems/1"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Basic dGVzdDp0ZXN0",
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ count: 1 }));
  });

  it("appends api-version to URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const client = new TestClient(createConfig());
    await client.testRequest("projects");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("api-version=7.1");
  });

  it("throws AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new TestClient(createConfig());
    await expect(client.testRequest("projects")).rejects.toThrow(AuthenticationError);
  });

  it("throws NotFoundError on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Not found" }),
    });

    const client = new TestClient(createConfig());
    await expect(client.testRequest("wit/workitems/99999")).rejects.toThrow(NotFoundError);
  });

  it("retries on 429 with backoff", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "1" }),
          json: () => Promise.resolve({ message: "Rate limited" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });
    });

    const client = new TestClient(createConfig());
    const result = await client.testRequest("projects");
    expect(callCount).toBe(2);
    expect(result).toEqual(expect.objectContaining({ value: [] }));
  });

  it("handles 204 No Content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });

    const client = new TestClient(createConfig());
    const result = await client.testRequest("some/delete");
    expect(result).toBeUndefined();
  });
});
