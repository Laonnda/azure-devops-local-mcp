/**
 * Personal Access Token authentication provider.
 * PAT scope requirements per tool are documented in tool files.
 */

import type { AuthProvider } from "./types.js";

export class PatAuthProvider implements AuthProvider {
  private readonly headerValue: string;

  constructor(pat: string) {
    if (!pat || pat.trim().length === 0) {
      throw new Error("ADO_PAT is required but was empty");
    }
    // Azure DevOps expects Basic auth with empty username and PAT as password
    const encoded = Buffer.from(`:${pat}`).toString("base64");
    this.headerValue = `Basic ${encoded}`;
  }

  async getAuthHeader(): Promise<string> {
    return this.headerValue;
  }
}
