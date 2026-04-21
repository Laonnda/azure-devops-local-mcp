/**
 * Shared Zod schemas for the Test Plans API area.
 */

import { z } from "zod";

export const testPlanIdSchema = z.number().int().positive().describe("Test plan ID");

export const testSuiteIdSchema = z.number().int().positive().describe("Test suite ID");

export const suiteTypeSchema = z
  .enum(["staticTestSuite", "requirementTestSuite", "dynamicTestSuite"])
  .describe(
    "Suite type: staticTestSuite (test cases added manually), " +
      "requirementTestSuite (linked to a single backlog item — requirementId required), " +
      "dynamicTestSuite (auto-populated from WIQL query — queryString required, membership is read-only)",
  );
