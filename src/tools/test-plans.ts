/**
 * MCP tool registrations for Azure DevOps Test Plans.
 * PAT scope: vso.test (read), vso.test_write (create/update)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AdoConfig } from "../auth/types.js";
import { TestPlansClient } from "../clients/test-plans-client.js";
import { projectNameSchema, topSchema } from "../validation/common.js";
import { testPlanIdSchema, testSuiteIdSchema, suiteTypeSchema } from "../validation/test-plans.js";
import { withErrorHandling } from "../utils/errors.js";

export function registerTestPlansTools(server: McpServer, config: AdoConfig): void {
  const client = new TestPlansClient(config);

  // --- ado_testplans_list ---
  server.registerTool(
    "ado_testplans_list",
    {
      description:
        "List test plans in an Azure DevOps project. " +
        "Returns each plan's ID, name, area path, iteration, state, and the root suite ID. " +
        "The root suite ID is needed when creating child suites with ado_testsuites_create.",
      inputSchema: {
        project: projectNameSchema
          .optional()
          .describe("Project to list plans for. Uses default if omitted."),
        top: topSchema.describe("Max results (default 50, max 200)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, top }) => {
      const plans = await client.listPlans(project, { top });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: plans.length, plans }, null, 2),
          },
        ],
      };
    }),
  );

  // --- ado_testplans_get ---
  server.registerTool(
    "ado_testplans_get",
    {
      description:
        "Get details of a single test plan by ID. " +
        "Returns name, area path, iteration, state, start/end dates, and the root suite ID. " +
        "Use ado_testplans_list to discover plan IDs.",
      inputSchema: {
        project: projectNameSchema
          .optional()
          .describe("Project that owns the plan. Uses default if omitted."),
        planId: testPlanIdSchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, planId }) => {
      const resolvedProject = project ?? config.defaultProject ?? "";
      const plan = await client.getPlan(resolvedProject, planId);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(plan, null, 2),
          },
        ],
      };
    }),
  );

  // --- ado_testplans_create ---
  server.registerTool(
    "ado_testplans_create",
    {
      description:
        "Create a new test plan in Azure DevOps. " +
        "ADO automatically creates a root suite alongside the plan — the response includes rootSuiteId. " +
        "Pass rootSuiteId as parentSuiteId when calling ado_testsuites_create to add child suites. " +
        "Requires vso.test_write PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project to create the test plan in"),
        name: z.string().min(1).max(256).describe("Test plan name"),
        areaPath: z
          .string()
          .max(256)
          .optional()
          .describe("Area path, e.g. 'MyProject\\\\MyTeam'. Defaults to project root."),
        iteration: z
          .string()
          .max(256)
          .optional()
          .describe("Iteration path, e.g. 'MyProject\\\\Sprint 1'."),
        startDate: z
          .string()
          .optional()
          .describe("Plan start date in ISO 8601 format, e.g. '2024-01-01'."),
        endDate: z
          .string()
          .optional()
          .describe("Plan end date in ISO 8601 format, e.g. '2024-01-14'."),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, name, areaPath, iteration, startDate, endDate }) => {
      const plan = await client.createPlan(project, name, {
        areaPath,
        iteration,
        startDate,
        endDate,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: `Created test plan '${plan.name}' (ID: ${plan.id}). Root suite ID: ${plan.rootSuiteId} — use this as parentSuiteId when creating child suites.`,
                plan,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  // --- ado_testsuites_list ---
  server.registerTool(
    "ado_testsuites_list",
    {
      description:
        "List all suites in a test plan. " +
        "Returns each suite's ID, name, type, state, test case count, and parent suite ID. " +
        "Use ado_testplans_list to find plan IDs.",
      inputSchema: {
        project: projectNameSchema
          .optional()
          .describe("Project that owns the plan. Uses default if omitted."),
        planId: testPlanIdSchema,
        top: topSchema.describe("Max results (default 50, max 200)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, planId, top }) => {
      const resolvedProject = project ?? config.defaultProject ?? "";
      const suites = await client.listSuites(resolvedProject, planId, { top });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: suites.length, suites }, null, 2),
          },
        ],
      };
    }),
  );

  // --- ado_testsuites_create ---
  server.registerTool(
    "ado_testsuites_create",
    {
      description:
        "Create a new suite inside a test plan. " +
        "suiteType must be staticTestSuite (test cases added manually), " +
        "requirementTestSuite (linked to one backlog item — requirementId required), or " +
        "dynamicTestSuite (auto-populated from WIQL — queryString required, membership is read-only). " +
        "Set parentSuiteId to the plan's rootSuiteId (from ado_testplans_create/get) to attach directly under root. " +
        "Requires vso.test_write PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project that owns the test plan"),
        planId: testPlanIdSchema,
        name: z.string().min(1).max(256).describe("Suite name"),
        suiteType: suiteTypeSchema,
        parentSuiteId: testSuiteIdSchema
          .optional()
          .describe(
            "Parent suite ID. Use the plan's rootSuiteId for top-level suites. " +
              "Omit to attach under the root suite automatically.",
          ),
        requirementId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Work item ID of the backlog item to link. Required when suiteType is requirementTestSuite.",
          ),
        queryString: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe(
            "WIQL SELECT statement for auto-populating the suite. Required when suiteType is dynamicTestSuite.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(
      async ({ project, planId, name, suiteType, parentSuiteId, requirementId, queryString }) => {
        const suite = await client.createSuite(project, planId, name, suiteType, {
          parentSuiteId,
          requirementId,
          queryString,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  message: `Created ${suiteType} '${suite.name}' (ID: ${suite.id}) in plan ${planId}.`,
                  suite,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    ),
  );

  // --- ado_testcases_add_to_suite ---
  server.registerTool(
    "ado_testcases_add_to_suite",
    {
      description:
        "Add existing Test Case work items to a suite. " +
        "Pass an array of work item IDs that have type 'Test Case'. " +
        "Use ado_workitems_create with type='Test Case' to create new test cases first. " +
        "Only works for staticTestSuite — dynamicTestSuite membership is query-driven. " +
        "Requires vso.test_write PAT scope.",
      inputSchema: {
        project: projectNameSchema.describe("Project that owns the test plan"),
        planId: testPlanIdSchema,
        suiteId: testSuiteIdSchema,
        testCaseIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(100)
          .describe("Work item IDs of the Test Case items to add (max 100 per call)"),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, planId, suiteId, testCaseIds }) => {
      const added = await client.addTestCasesToSuite(project, planId, suiteId, testCaseIds);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: `Added ${added.length} test case(s) to suite ${suiteId} in plan ${planId}.`,
                testCases: added,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  // --- ado_testcases_list ---
  server.registerTool(
    "ado_testcases_list",
    {
      description:
        "List test cases assigned to a suite. " +
        "Returns each test case's work item ID and title. " +
        "Use ado_workitems_get for full test case details including steps.",
      inputSchema: {
        project: projectNameSchema
          .optional()
          .describe("Project that owns the plan. Uses default if omitted."),
        planId: testPlanIdSchema,
        suiteId: testSuiteIdSchema,
        top: topSchema.describe("Max results (default 50, max 200)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async ({ project, planId, suiteId, top }) => {
      const resolvedProject = project ?? config.defaultProject ?? "";
      const testCases = await client.listTestCasesInSuite(resolvedProject, planId, suiteId, { top });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: testCases.length, testCases }, null, 2),
          },
        ],
      };
    }),
  );
}
