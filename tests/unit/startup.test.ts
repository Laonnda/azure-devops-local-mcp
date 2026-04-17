import { describe, it, expect } from "vitest";

/**
 * Tests for startup validation in src/index.ts.
 * We exercise the validation logic by spawning the compiled entry point
 * as a child process (or by extracting the logic into a testable form).
 *
 * Because index.ts side-effects (connects transports, calls process.exit),
 * we test it via child_process so we don't pollute the test runner process.
 */
import { execFile } from "node:child_process";
import { resolve } from "node:path";

const ENTRY = resolve("dist/index.js");

/** Run the server entry with the given env + args, expecting it to exit quickly. */
async function runEntry(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [ENTRY, ...args],
      {
        env: {
          // Provide a dummy org URL so loadConfig() doesn't fail first
          ADO_ORG_URL: "https://dev.azure.com/testorg",
          ADO_PAT: "dummy-pat",
          ...env,
        },
        timeout: 5000,
      },
      (_err, stdout, stderr) => {
        // _err is set when the process exits non-zero — that's expected
        const exitCode =
          (_err as NodeJS.ErrnoException & { code?: number }) !== null &&
          typeof (_err as NodeJS.ErrnoException & { code?: number }).code === "number"
            ? ((_err as NodeJS.ErrnoException & { code?: number }).code ?? null)
            : 0;
        resolve({ exitCode, stderr, stdout });
      },
    );
  });
}

describe("--transport CLI argument validation", () => {
  it("exits with code 1 when --transport has no value", async () => {
    const { exitCode, stderr } = await runEntry(["--transport"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--transport requires a value/i);
  });

  it("exits with code 1 for an unknown transport value", async () => {
    const { exitCode, stderr } = await runEntry(["--transport", "foo"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/unknown transport.*foo/i);
  });

  it("exits with code 1 for transport value 'sse'", async () => {
    const { exitCode, stderr } = await runEntry(["--transport", "sse"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/unknown transport/i);
  });
});

describe("PORT env var validation", () => {
  it("exits with code 1 when PORT is non-numeric", async () => {
    const { exitCode, stderr } = await runEntry(["--transport", "http"], {
      PORT: "abc",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/port must be a number/i);
  });

  it("exits with code 1 when PORT is 0", async () => {
    const { exitCode, stderr } = await runEntry(["--transport", "http"], {
      PORT: "0",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/port must be a number/i);
  });

  it("exits with code 1 when PORT is above 65535", async () => {
    const { exitCode, stderr } = await runEntry(["--transport", "http"], {
      PORT: "99999",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/port must be a number/i);
  });

  it("exits with code 1 when PORT is negative", async () => {
    const { exitCode, stderr } = await runEntry(["--transport", "http"], {
      PORT: "-1",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/port must be a number/i);
  });
});
