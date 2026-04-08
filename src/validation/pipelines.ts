/**
 * Zod schemas for pipeline/build tool inputs.
 */

import { z } from "zod";

export { projectNameSchema, topSchema } from "./common.js";

/** Positive integer for pipeline definition IDs */
export const pipelineIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Pipeline definition ID");

/** Positive integer for build/run IDs */
export const buildIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Build or run ID");

/** Filter builds by status */
export const statusFilterSchema = z
  .enum(["completed", "inProgress", "notStarted", "all"])
  .describe("Build status filter");

/** Build/run result value */
export const runResultSchema = z
  .enum(["unknown", "succeeded", "partiallySucceeded", "failed", "canceled"])
  .describe("Build or run result");
