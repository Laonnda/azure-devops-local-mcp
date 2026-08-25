/**
 * Azure DevOps Test Plans API client.
 * PAT scope required: vso.test (read), vso.test_write (create/update)
 */

import type { AdoConfig } from "../auth/types.js";
import { BaseClient } from "./base-client.js";

const TEST_PLAN_API_VERSION = "7.1";

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface TestPlan {
  id: number;
  name: string;
  areaPath: string;
  iteration: string;
  state: string;
  /** ID of the root suite auto-created with this plan. Use as parentSuiteId when creating child suites. */
  rootSuiteId: number;
  rootSuiteName: string;
  startDate: string | null;
  endDate: string | null;
  webUrl: string;
}

export interface TestSuite {
  id: number;
  name: string;
  suiteType: string;
  state: string;
  testCaseCount: number;
  lastUpdatedDate: string | null;
  parentSuiteId: number | null;
  parentSuiteName: string | null;
  requirementId: number | null;
  queryString: string | null;
  hasChildren: boolean;
  webUrl: string;
}

export interface TestCaseReference {
  id: number;
  title: string;
  url: string;
}

export type SuiteType = "staticTestSuite" | "requirementTestSuite" | "dynamicTestSuite";

// ─── Raw API response shapes ──────────────────────────────────────────────────

interface RawTestPlan {
  id: number;
  name: string;
  areaPath?: string;
  iteration?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  rootSuite?: { id: number; name: string };
  _links?: { web?: { href: string } };
}

interface RawTestSuite {
  id: number;
  name: string;
  suiteType?: string;
  state?: string;
  testCaseCount?: number;
  lastUpdatedDate?: string;
  parentSuite?: { id: number; name: string };
  requirementId?: number;
  queryString?: string;
  hasChildren?: boolean;
  _links?: { web?: { href: string } };
}

interface RawTestCase {
  workItem?: {
    id: number;
    name?: string;
    url?: string;
  };
}

interface RawListResponse<T> {
  count: number;
  value: T[];
}

// ─── Mapper functions ─────────────────────────────────────────────────────────

function mapTestPlan(raw: RawTestPlan): TestPlan {
  return {
    id: raw.id,
    name: raw.name,
    areaPath: raw.areaPath || "",
    iteration: raw.iteration || "",
    state: raw.state || "Active",
    rootSuiteId: raw.rootSuite?.id ?? 0,
    rootSuiteName: raw.rootSuite?.name || "",
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    webUrl: raw._links?.web?.href || "",
  };
}

function mapTestSuite(raw: RawTestSuite): TestSuite {
  return {
    id: raw.id,
    name: raw.name,
    suiteType: raw.suiteType || "staticTestSuite",
    state: raw.state || "InProgress",
    testCaseCount: raw.testCaseCount ?? 0,
    lastUpdatedDate: raw.lastUpdatedDate ?? null,
    parentSuiteId: raw.parentSuite?.id ?? null,
    parentSuiteName: raw.parentSuite?.name ?? null,
    requirementId: raw.requirementId ?? null,
    queryString: raw.queryString ?? null,
    hasChildren: raw.hasChildren ?? false,
    webUrl: raw._links?.web?.href || "",
  };
}

function mapTestCase(raw: RawTestCase): TestCaseReference {
  return {
    id: raw.workItem?.id ?? 0,
    title: raw.workItem?.name || "",
    url: raw.workItem?.url || "",
  };
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class TestPlansClient extends BaseClient {
  constructor(config: AdoConfig) {
    super(config);
  }

  /**
   * List test plans in a project.
   * PAT scope: vso.test
   */
  async listPlans(project?: string, opts: { top?: number } = {}): Promise<TestPlan[]> {
    const resolvedProject = this.resolveProject(project);
    const top = opts.top ?? 50;

    const raw = await this.request<RawListResponse<RawTestPlan>>(`testplan/plans?$top=${top}`, {
      project: resolvedProject,
      apiVersion: TEST_PLAN_API_VERSION,
    });

    return (raw.value || []).map(mapTestPlan);
  }

  /**
   * Get a single test plan by ID.
   * PAT scope: vso.test
   */
  async getPlan(project: string, planId: number): Promise<TestPlan> {
    const resolvedProject = this.resolveProject(project);

    const raw = await this.request<RawTestPlan>(`testplan/plans/${planId}`, {
      project: resolvedProject,
      apiVersion: TEST_PLAN_API_VERSION,
    });

    return mapTestPlan(raw);
  }

  /**
   * Create a new test plan. ADO auto-creates a root suite — capture rootSuiteId from the
   * response and pass it as parentSuiteId when creating child suites.
   * PAT scope: vso.test_write
   */
  async createPlan(
    project: string,
    name: string,
    opts: { areaPath?: string; iteration?: string; startDate?: string; endDate?: string } = {},
  ): Promise<TestPlan> {
    const resolvedProject = this.resolveProject(project);

    const body: Record<string, unknown> = { name };
    if (opts.areaPath) body.areaPath = opts.areaPath;
    if (opts.iteration) body.iteration = opts.iteration;
    if (opts.startDate) body.startDate = opts.startDate;
    if (opts.endDate) body.endDate = opts.endDate;

    const raw = await this.request<RawTestPlan>(`testplan/plans`, {
      method: "POST",
      body,
      project: resolvedProject,
      apiVersion: TEST_PLAN_API_VERSION,
    });

    return mapTestPlan(raw);
  }

  /**
   * List all suites in a test plan.
   * PAT scope: vso.test
   */
  async listSuites(
    project: string,
    planId: number,
    opts: { top?: number } = {},
  ): Promise<TestSuite[]> {
    const resolvedProject = this.resolveProject(project);
    const top = opts.top ?? 50;

    const raw = await this.request<RawListResponse<RawTestSuite>>(
      `testplan/Plans/${planId}/suites?$top=${top}`,
      { project: resolvedProject, apiVersion: TEST_PLAN_API_VERSION },
    );

    return (raw.value || []).map(mapTestSuite);
  }

  /**
   * Create a suite inside a test plan.
   * For requirementTestSuite: opts.requirementId is required.
   * For dynamicTestSuite: opts.queryString is required.
   * PAT scope: vso.test_write
   */
  async createSuite(
    project: string,
    planId: number,
    name: string,
    suiteType: SuiteType,
    opts: {
      parentSuiteId?: number;
      requirementId?: number;
      queryString?: string;
    } = {},
  ): Promise<TestSuite> {
    const resolvedProject = this.resolveProject(project);

    const body: Record<string, unknown> = { name, suiteType };

    if (opts.parentSuiteId !== undefined) {
      body.parentSuite = { id: opts.parentSuiteId };
    }
    if (suiteType === "requirementTestSuite" && opts.requirementId !== undefined) {
      body.requirementId = opts.requirementId;
    }
    if (suiteType === "dynamicTestSuite" && opts.queryString) {
      body.queryString = opts.queryString;
    }

    const raw = await this.request<RawTestSuite>(`testplan/Plans/${planId}/suites`, {
      method: "POST",
      body,
      project: resolvedProject,
      apiVersion: TEST_PLAN_API_VERSION,
    });

    return mapTestSuite(raw);
  }

  /**
   * Add existing Test Case work items to a suite.
   * Pass work item IDs for work items of type "Test Case".
   * Use ado_workitems_create with type="Test Case" to create new ones first.
   * PAT scope: vso.test_write
   */
  async addTestCasesToSuite(
    project: string,
    planId: number,
    suiteId: number,
    testCaseIds: number[],
  ): Promise<TestCaseReference[]> {
    const resolvedProject = this.resolveProject(project);

    const body = testCaseIds.map((id) => ({
      workItem: { id },
      pointAssignments: [],
    }));

    // ADO testplan API may return a direct array or a list-wrapper depending on version
    const raw = await this.request<RawListResponse<RawTestCase> | RawTestCase[]>(
      `testplan/Plans/${planId}/Suites/${suiteId}/TestCase`,
      { method: "POST", body, project: resolvedProject, apiVersion: TEST_PLAN_API_VERSION },
    );

    const items = Array.isArray(raw) ? raw : raw.value || [];
    return items.map(mapTestCase);
  }

  /**
   * List test cases assigned to a suite.
   * PAT scope: vso.test
   */
  async listTestCasesInSuite(
    project: string,
    planId: number,
    suiteId: number,
    opts: { top?: number } = {},
  ): Promise<TestCaseReference[]> {
    const resolvedProject = this.resolveProject(project);
    const top = opts.top ?? 50;

    const raw = await this.request<RawListResponse<RawTestCase>>(
      `testplan/Plans/${planId}/Suites/${suiteId}/TestCase?$top=${top}`,
      { project: resolvedProject, apiVersion: TEST_PLAN_API_VERSION },
    );

    return (raw.value || []).map(mapTestCase);
  }
}
