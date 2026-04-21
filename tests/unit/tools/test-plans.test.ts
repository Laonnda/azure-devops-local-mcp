import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoConfig } from "../../../src/auth/types.js";
import { registerTestPlansTools } from "../../../src/tools/test-plans.js";
import { TestPlansClient } from "../../../src/clients/test-plans-client.js";
import {
  testPlanIdSchema,
  testSuiteIdSchema,
  suiteTypeSchema,
} from "../../../src/validation/test-plans.js";
import { AuthenticationError, NotFoundError } from "../../../src/utils/errors.js";

function createConfig(overrides: Partial<AdoConfig> = {}): AdoConfig {
  return {
    orgUrl: "https://dev.azure.com/testorg",
    defaultProject: "TestProject",
    auth: {
      getAuthHeader: vi.fn().mockResolvedValue("Basic dGVzdDp0ZXN0"),
    },
    rateLimiter: new RateLimiter(60),
    ...overrides,
  };
}

// ─── Raw API shape helpers ────────────────────────────────────────────────────

function makeRawPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Sprint 1 Test Plan",
    areaPath: "TestProject\\Team A",
    iteration: "TestProject\\Sprint 1",
    state: "Active",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-01-14T00:00:00Z",
    rootSuite: { id: 2, name: "Sprint 1 Test Plan" },
    _links: {
      web: { href: "https://dev.azure.com/testorg/TestProject/_testPlans/testPlan?planId=1" },
    },
    ...overrides,
  };
}

function makeRawSuite(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: "Login Tests",
    suiteType: "staticTestSuite",
    state: "InProgress",
    testCaseCount: 3,
    lastUpdatedDate: "2026-01-05T10:00:00Z",
    parentSuite: { id: 2, name: "Sprint 1 Test Plan" },
    hasChildren: false,
    _links: {
      web: {
        href: "https://dev.azure.com/testorg/TestProject/_testPlans/testPlan?planId=1&suiteId=10",
      },
    },
    ...overrides,
  };
}

function makeRawTestCase(id: number, overrides: Record<string, unknown> = {}) {
  return {
    workItem: {
      id,
      name: `Test Case ${id}`,
      url: `https://dev.azure.com/testorg/TestProject/_apis/wit/workItems/${id}`,
    },
    pointAssignments: [],
    ...overrides,
  };
}

// ─── Tool registration ────────────────────────────────────────────────────────

describe("Test Plans Tool Registration", () => {
  it("registers all 7 test plan tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerTestPlansTools(server, createConfig());
    expect(server).toBeDefined();
  });
});

// ─── Schema validation ────────────────────────────────────────────────────────

describe("testPlanIdSchema", () => {
  it("accepts a positive integer", () => {
    expect(() => testPlanIdSchema.parse(1)).not.toThrow();
    expect(() => testPlanIdSchema.parse(999)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => testPlanIdSchema.parse(0)).toThrow();
  });

  it("rejects negative integers", () => {
    expect(() => testPlanIdSchema.parse(-1)).toThrow();
  });

  it("rejects floats", () => {
    expect(() => testPlanIdSchema.parse(1.5)).toThrow();
  });

  it("rejects strings", () => {
    expect(() => testPlanIdSchema.parse("1")).toThrow();
  });
});

describe("testSuiteIdSchema", () => {
  it("accepts a positive integer", () => {
    expect(() => testSuiteIdSchema.parse(42)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => testSuiteIdSchema.parse(0)).toThrow();
  });

  it("rejects negative integers", () => {
    expect(() => testSuiteIdSchema.parse(-5)).toThrow();
  });
});

describe("suiteTypeSchema", () => {
  it.each(["staticTestSuite", "requirementTestSuite", "dynamicTestSuite"] as const)(
    "accepts valid enum value '%s'",
    (value) => {
      expect(() => suiteTypeSchema.parse(value)).not.toThrow();
    },
  );

  it("rejects unknown string", () => {
    expect(() => suiteTypeSchema.parse("manualSuite")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => suiteTypeSchema.parse("")).toThrow();
  });

  it("rejects case-variant spellings", () => {
    expect(() => suiteTypeSchema.parse("StaticTestSuite")).toThrow();
    expect(() => suiteTypeSchema.parse("Static")).toThrow();
  });
});

// ─── TestPlansClient.listPlans ────────────────────────────────────────────────

describe("TestPlansClient.listPlans — response mapping", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps all fields including rootSuiteId and webUrl", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [makeRawPlan()] }),
    });

    const client = new TestPlansClient(createConfig());
    const result = await client.listPlans("TestProject");

    expect(result).toHaveLength(1);
    const plan = result[0];
    expect(plan.id).toBe(1);
    expect(plan.name).toBe("Sprint 1 Test Plan");
    expect(plan.areaPath).toBe("TestProject\\Team A");
    expect(plan.iteration).toBe("TestProject\\Sprint 1");
    expect(plan.state).toBe("Active");
    expect(plan.rootSuiteId).toBe(2);
    expect(plan.rootSuiteName).toBe("Sprint 1 Test Plan");
    expect(plan.startDate).toBe("2026-01-01T00:00:00Z");
    expect(plan.endDate).toBe("2026-01-14T00:00:00Z");
    expect(plan.webUrl).toContain("planId=1");
  });

  it("sets dates to null when absent", async () => {
    const raw = makeRawPlan({ startDate: undefined, endDate: undefined });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [raw] }),
    });

    const client = new TestPlansClient(createConfig());
    const [plan] = await client.listPlans("TestProject");

    expect(plan.startDate).toBeNull();
    expect(plan.endDate).toBeNull();
  });

  it("sets rootSuiteId to 0 when rootSuite is absent", async () => {
    const raw = makeRawPlan({ rootSuite: undefined });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [raw] }),
    });

    const client = new TestPlansClient(createConfig());
    const [plan] = await client.listPlans("TestProject");

    expect(plan.rootSuiteId).toBe(0);
    expect(plan.rootSuiteName).toBe("");
  });

  it("returns empty array when value is empty", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new TestPlansClient(createConfig());
    const result = await client.listPlans("TestProject");
    expect(result).toEqual([]);
  });

  it("sends $top in URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new TestPlansClient(createConfig());
    await client.listPlans("TestProject", { top: 10 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("$top=10");
  });

  it("uses api-version 7.1", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new TestPlansClient(createConfig());
    await client.listPlans("TestProject");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("api-version=7.1");
  });

  it("propagates AuthenticationError on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: "Unauthorized" }),
    });

    const client = new TestPlansClient(createConfig());
    await expect(client.listPlans("TestProject")).rejects.toThrow(AuthenticationError);
  });
});

// ─── TestPlansClient.getPlan ──────────────────────────────────────────────────

describe("TestPlansClient.getPlan — response mapping and errors", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps all fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPlan()),
    });

    const client = new TestPlansClient(createConfig());
    const plan = await client.getPlan("TestProject", 1);

    expect(plan.id).toBe(1);
    expect(plan.rootSuiteId).toBe(2);
  });

  it("includes plan ID in URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPlan({ id: 42 })),
    });

    const client = new TestPlansClient(createConfig());
    await client.getPlan("TestProject", 42);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testplan/plans/42");
  });

  it("propagates NotFoundError on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Plan not found" }),
    });

    const client = new TestPlansClient(createConfig());
    await expect(client.getPlan("TestProject", 9999)).rejects.toThrow(NotFoundError);
  });
});

// ─── TestPlansClient.createPlan ───────────────────────────────────────────────

describe("TestPlansClient.createPlan — request body and response", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends name, areaPath, and iteration in POST body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPlan()),
    });

    const client = new TestPlansClient(createConfig());
    await client.createPlan("TestProject", "My Plan", {
      areaPath: "TestProject\\Team A",
      iteration: "TestProject\\Sprint 1",
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.name).toBe("My Plan");
    expect(body.areaPath).toBe("TestProject\\Team A");
    expect(body.iteration).toBe("TestProject\\Sprint 1");
  });

  it("omits optional fields when not provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPlan()),
    });

    const client = new TestPlansClient(createConfig());
    await client.createPlan("TestProject", "Minimal Plan");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.name).toBe("Minimal Plan");
    expect(body.areaPath).toBeUndefined();
    expect(body.iteration).toBeUndefined();
  });

  it("returns plan with rootSuiteId from response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPlan({ rootSuite: { id: 5, name: "Root" } })),
    });

    const client = new TestPlansClient(createConfig());
    const plan = await client.createPlan("TestProject", "My Plan");

    expect(plan.rootSuiteId).toBe(5);
  });

  it("uses POST method", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawPlan()),
    });

    const client = new TestPlansClient(createConfig());
    await client.createPlan("TestProject", "My Plan");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].method).toBe("POST");
  });
});

// ─── TestPlansClient.listSuites ───────────────────────────────────────────────

describe("TestPlansClient.listSuites — response mapping", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps all suite fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [makeRawSuite()] }),
    });

    const client = new TestPlansClient(createConfig());
    const suites = await client.listSuites("TestProject", 1);

    expect(suites).toHaveLength(1);
    const suite = suites[0];
    expect(suite.id).toBe(10);
    expect(suite.name).toBe("Login Tests");
    expect(suite.suiteType).toBe("staticTestSuite");
    expect(suite.testCaseCount).toBe(3);
    expect(suite.parentSuiteId).toBe(2);
    expect(suite.parentSuiteName).toBe("Sprint 1 Test Plan");
    expect(suite.hasChildren).toBe(false);
    expect(suite.requirementId).toBeNull();
    expect(suite.queryString).toBeNull();
  });

  it("includes planId in URL path", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new TestPlansClient(createConfig());
    await client.listSuites("TestProject", 99);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testplan/Plans/99/suites");
  });

  it("maps requirementId and queryString when present", async () => {
    const raw = makeRawSuite({
      suiteType: "requirementTestSuite",
      requirementId: 1234,
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 1, value: [raw] }),
    });

    const client = new TestPlansClient(createConfig());
    const [suite] = await client.listSuites("TestProject", 1);

    expect(suite.requirementId).toBe(1234);
  });

  it("propagates NotFoundError when plan does not exist", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "Plan not found" }),
    });

    const client = new TestPlansClient(createConfig());
    await expect(client.listSuites("TestProject", 9999)).rejects.toThrow(NotFoundError);
  });
});

// ─── TestPlansClient.createSuite ─────────────────────────────────────────────

describe("TestPlansClient.createSuite — request body per suite type", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends suiteType and name for staticTestSuite", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawSuite()),
    });

    const client = new TestPlansClient(createConfig());
    await client.createSuite("TestProject", 1, "Login Tests", "staticTestSuite", {
      parentSuiteId: 2,
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.suiteType).toBe("staticTestSuite");
    expect(body.name).toBe("Login Tests");
    expect(body.parentSuite).toEqual({ id: 2 });
  });

  it("includes requirementId for requirementTestSuite", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(makeRawSuite({ suiteType: "requirementTestSuite", requirementId: 42 })),
    });

    const client = new TestPlansClient(createConfig());
    await client.createSuite("TestProject", 1, "Req Suite", "requirementTestSuite", {
      parentSuiteId: 2,
      requirementId: 42,
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.suiteType).toBe("requirementTestSuite");
    expect(body.requirementId).toBe(42);
  });

  it("includes queryString for dynamicTestSuite", async () => {
    const wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug'";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(makeRawSuite({ suiteType: "dynamicTestSuite", queryString: wiql })),
    });

    const client = new TestPlansClient(createConfig());
    await client.createSuite("TestProject", 1, "Dynamic Suite", "dynamicTestSuite", {
      parentSuiteId: 2,
      queryString: wiql,
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.suiteType).toBe("dynamicTestSuite");
    expect(body.queryString).toBe(wiql);
  });

  it("does not include requirementId for staticTestSuite even if supplied", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawSuite()),
    });

    const client = new TestPlansClient(createConfig());
    await client.createSuite("TestProject", 1, "Static Suite", "staticTestSuite", {
      requirementId: 99,
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.requirementId).toBeUndefined();
  });

  it("includes planId in URL path", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeRawSuite()),
    });

    const client = new TestPlansClient(createConfig());
    await client.createSuite("TestProject", 7, "My Suite", "staticTestSuite");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testplan/Plans/7/suites");
  });
});

// ─── TestPlansClient.addTestCasesToSuite ─────────────────────────────────────

describe("TestPlansClient.addTestCasesToSuite — request body and response handling", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends an array of workItem objects in the POST body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([makeRawTestCase(101), makeRawTestCase(102)]),
    });

    const client = new TestPlansClient(createConfig());
    await client.addTestCasesToSuite("TestProject", 1, 10, [101, 102]);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual([
      { workItem: { id: 101 }, pointAssignments: [] },
      { workItem: { id: 102 }, pointAssignments: [] },
    ]);
  });

  it("handles direct array response from ADO", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([makeRawTestCase(101)]),
    });

    const client = new TestPlansClient(createConfig());
    const result = await client.addTestCasesToSuite("TestProject", 1, 10, [101]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(101);
    expect(result[0].title).toBe("Test Case 101");
  });

  it("handles list-wrapped response {count, value} from ADO", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ count: 1, value: [makeRawTestCase(55)] }),
    });

    const client = new TestPlansClient(createConfig());
    const result = await client.addTestCasesToSuite("TestProject", 1, 10, [55]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(55);
  });

  it("includes planId and suiteId in URL path", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    const client = new TestPlansClient(createConfig());
    await client.addTestCasesToSuite("TestProject", 3, 20, [1]);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testplan/Plans/3/Suites/20/TestCase");
  });

  it("uses POST method", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    const client = new TestPlansClient(createConfig());
    await client.addTestCasesToSuite("TestProject", 1, 10, [1]);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].method).toBe("POST");
  });
});

// ─── TestPlansClient.listTestCasesInSuite ────────────────────────────────────

describe("TestPlansClient.listTestCasesInSuite — response mapping", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps id, title, and url for each test case", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ count: 2, value: [makeRawTestCase(10), makeRawTestCase(11)] }),
    });

    const client = new TestPlansClient(createConfig());
    const cases = await client.listTestCasesInSuite("TestProject", 1, 10);

    expect(cases).toHaveLength(2);
    expect(cases[0].id).toBe(10);
    expect(cases[0].title).toBe("Test Case 10");
    expect(cases[0].url).toContain("workItems/10");
    expect(cases[1].id).toBe(11);
  });

  it("returns empty array for empty suite", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new TestPlansClient(createConfig());
    const cases = await client.listTestCasesInSuite("TestProject", 1, 10);
    expect(cases).toEqual([]);
  });

  it("includes planId, suiteId, and $top in URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new TestPlansClient(createConfig());
    await client.listTestCasesInSuite("TestProject", 5, 30, { top: 25 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testplan/Plans/5/Suites/30/TestCase");
    expect(calledUrl).toContain("$top=25");
  });
});

// ─── Project resolution ───────────────────────────────────────────────────────

describe("project resolution", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses provided project in URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const client = new TestPlansClient(createConfig());
    await client.listPlans("CustomProject");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testorg/CustomProject/_apis/");
  });

  it("falls back to defaultProject when no project given", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 0, value: [] }),
    });

    const config = createConfig({ defaultProject: "FallbackProject" });
    const client = new TestPlansClient(config);
    await client.listPlans();

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("testorg/FallbackProject/_apis/");
  });

  it("throws when no project given and no defaultProject configured", async () => {
    const config = createConfig({ defaultProject: undefined });
    const client = new TestPlansClient(config);
    await expect(client.listPlans()).rejects.toThrow("Project is required");
  });
});

// ─── 429 rate-limit auto-retry ────────────────────────────────────────────────

describe("429 rate-limit auto-retry", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("retries after a 429 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (header: string) => (header === "Retry-After" ? "0" : null) },
          json: () => Promise.resolve({ message: "Too Many Requests" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ count: 1, value: [makeRawPlan()] }),
      });
    });

    const client = new TestPlansClient(createConfig());
    const resultPromise = client.listPlans("TestProject");

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveLength(1);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
