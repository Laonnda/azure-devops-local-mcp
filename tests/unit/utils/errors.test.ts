import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withErrorHandling,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  AdoMcpError,
} from "../../../src/utils/errors.js";
import { logger } from "../../../src/utils/logger.js";

describe("withErrorHandling", () => {
  beforeEach(() => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through successful handler result unchanged", async () => {
    const handler = withErrorHandling(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const result = await handler({});
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("returns MCP error format on AuthenticationError", async () => {
    const handler = withErrorHandling(async () => {
      throw new AuthenticationError();
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Authentication failed. Check your PAT and organization URL.",
    );
  });

  it("returns MCP error format on NotFoundError", async () => {
    const handler = withErrorHandling(async () => {
      throw new NotFoundError("project 'MyProject'");
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Resource not found");
    expect(result.content[0].text).toContain("MyProject");
  });

  it("returns MCP error format on RateLimitError", async () => {
    const handler = withErrorHandling(async () => {
      throw new RateLimitError(5000);
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Rate limited");
    expect(result.content[0].text).toContain("5s");
  });

  it("returns MCP error format on ValidationError", async () => {
    const handler = withErrorHandling(async () => {
      throw new ValidationError("Field 'project' must not contain path traversal sequences.");
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("path traversal");
  });

  it("returns MCP error format on generic AdoMcpError", async () => {
    const handler = withErrorHandling(async () => {
      throw new AdoMcpError("Something went wrong", 500);
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Something went wrong");
  });

  it("returns generic message on unknown Error", async () => {
    const handler = withErrorHandling(async () => {
      throw new Error("internal boom");
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "An unexpected error occurred. Check your input and try again.",
    );
  });

  it("returns generic message on non-Error throw", async () => {
    const handler = withErrorHandling(async () => {
      throw "string error";
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "An unexpected error occurred. Check your input and try again.",
    );
  });

  it("logs warn for AuthenticationError", async () => {
    const handler = withErrorHandling(async () => {
      throw new AuthenticationError();
    });
    await handler({});
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs warn for RateLimitError", async () => {
    const handler = withErrorHandling(async () => {
      throw new RateLimitError(3000);
    });
    await handler({});
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs error for generic AdoMcpError (non-typed)", async () => {
    const handler = withErrorHandling(async () => {
      throw new AdoMcpError("server error", 500);
    });
    await handler({});
    expect(logger.error).toHaveBeenCalled();
  });

  it("does not leak credentials in error messages", async () => {
    const handler = withErrorHandling(async () => {
      throw new Error("failed with token Bearer eyJhbGciOiJIUzI1NiJ9.secret");
    });
    const result = await handler({});
    expect(result.content[0].text).not.toContain("Bearer");
    expect(result.content[0].text).not.toContain("eyJhbGci");
  });
});
