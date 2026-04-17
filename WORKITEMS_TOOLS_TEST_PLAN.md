# WORKITEMS_TOOLS_TEST_PLAN.md

Regression plan for two bugs fixed in work-item tools:
- **Bug 1** — `project` parameter ignored (wrong-project results)
- **Bug 2** — `count` field unreliable (returned count ≠ total matches)

Tests live in `tests/unit/tools/work-items-scoping.test.ts`.

---

## Bug 1 — Project scoping

| # | Tool / method | Input | Expected |
|---|---|---|---|
| 1 | `WorkItemsClient.query` | project "EMS" | WIQL URL contains `/EMS/_apis/` |
| 2 | `WorkItemsClient.query` | project "EMS", WIQL with no WHERE | Injected WIQL body contains `[System.TeamProject] = 'EMS'` |
| 3 | `WorkItemsClient.query` | project "DEMO PROJECT" | URL contains `DEMO%20PROJECT` |
| 4 | `WorkItemsClient.query` | project "DEMO PROJECT" | Injected WIQL body contains `[System.TeamProject] = 'DEMO PROJECT'` |
| 5 | `WorkItemsClient.query` | WIQL already has `[System.TeamProject]` | No double injection — condition appears exactly once |
| 6 | `injectProjectFilter` | WIQL with `ORDER BY` but no `WHERE` | Condition inserted before `ORDER BY` |
| 7 | `injectProjectFilter` | WIQL with no `WHERE` and no `ORDER BY` | Condition appended as `WHERE` clause |
| 8 | `WorkItemsClient.get` | project "EMS", item actually in "DEMO PROJECT" | Throws `ValidationError` naming "DEMO PROJECT" |

---

## Bug 2 — Count accuracy

| # | Tool / method | Input | Expected |
|---|---|---|---|
| 9  | `WorkItemsClient.query` | top=1, WIQL matches 5 items | `returnedCount=1`, `totalCount=5` |
| 10 | `WorkItemsClient.query` | top=200, WIQL matches 3 items | `returnedCount=3`, `totalCount=3` |
| 11 | `ado_workitems_list_recent` (tool) | top=2, 10 total matches | JSON response has `returnedCount=2`, `totalCount=10` |
| 12 | `WorkItemsClient.query` | WIQL matches 0 items | `returnedCount=0`, `totalCount=0`; no HTTP batch call made |

---

## Additional

| # | Scenario | Expected |
|---|---|---|
| 13 | `injectProjectFilter` with project name containing a single quote | Quote escaped as `''` in injected condition |
