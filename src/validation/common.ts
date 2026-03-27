/**
 * Shared Zod schemas for common input patterns.
 */

import { z } from "zod";

/** Alphanumeric, hyphens, underscores, spaces, dots. Max 256 chars. */
export const projectNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9 _.\-]+$/, "Invalid project name characters")
  .describe("Azure DevOps project name");

/** GUID or name */
export const repositoryIdSchema = z
  .string()
  .min(1)
  .max(256)
  .describe("Repository ID (GUID) or name");

/** Positive integer ID */
export const workItemIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Work item ID");

/** Positive integer PR ID */
export const pullRequestIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Pull request ID");

/** Pagination: top */
export const topSchema = z
  .number()
  .int()
  .min(1)
  .max(200)
  .default(50)
  .describe("Maximum number of results to return (max 200)");

/** Pagination: skip */
export const skipSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("Number of results to skip");

/** Continuation token */
export const continuationTokenSchema = z
  .string()
  .optional()
  .describe("Continuation token from a previous response for pagination");

/** Rejects path traversal patterns */
export function assertNoPathTraversal(value: string, fieldName: string): void {
  if (value.includes("../") || value.includes("..\\")) {
    throw new Error(`Path traversal detected in ${fieldName}`);
  }
}
