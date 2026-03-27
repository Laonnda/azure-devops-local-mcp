import { describe, it, expect } from "vitest";
import { sanitizeString, sanitizeObject } from "../../../src/utils/sanitize.js";

describe("sanitizeString", () => {
  it("redacts Basic auth headers", () => {
    const input = "Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==";
    const result = sanitizeString(input);
    expect(result).not.toContain("dXNlcjpwYXNzd29yZDEyMzQ1Ng==");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const result = sanitizeString(input);
    expect(result).toContain("[REDACTED]");
  });

  it("redacts password connection strings", () => {
    const input = "Server=myserver;Database=mydb;Password=s3cr3tP@ss;";
    const result = sanitizeString(input);
    expect(result).not.toContain("s3cr3tP@ss");
  });

  it("redacts credentials in URLs", () => {
    const input = "https://user:token123abc@dev.azure.com/org";
    const result = sanitizeString(input);
    expect(result).toContain("[REDACTED]");
  });

  it("leaves normal strings unchanged", () => {
    const input = "This is a normal log message about work item #123";
    expect(sanitizeString(input)).toBe(input);
  });
});

describe("sanitizeObject", () => {
  it("redacts sensitive keys in objects", () => {
    const input = {
      name: "test",
      token: "secret-value",
      authorization: "Basic abc123",
      data: "safe",
    };
    const result = sanitizeObject(input);
    expect(result.name).toBe("test");
    expect(result.token).toBe("[REDACTED]");
    expect(result.authorization).toBe("[REDACTED]");
    expect(result.data).toBe("safe");
  });

  it("handles nested objects", () => {
    const input = {
      outer: {
        password: "secret",
        value: "safe",
      },
    };
    const result = sanitizeObject(input);
    expect((result.outer as Record<string, string>).password).toBe("[REDACTED]");
    expect((result.outer as Record<string, string>).value).toBe("safe");
  });

  it("handles arrays", () => {
    const input = ["normal", "Bearer longtoken12345678901234567890"];
    const result = sanitizeObject(input);
    expect(result[0]).toBe("normal");
    expect(result[1]).toContain("[REDACTED]");
  });

  it("handles null and undefined", () => {
    expect(sanitizeObject(null)).toBeNull();
    expect(sanitizeObject(undefined)).toBeUndefined();
  });
});
