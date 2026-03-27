# CLAUDE.md -- ado-mcp Development Guidelines

## Project Summary

MCP server connecting Claude Code/Chat to Azure DevOps REST API v7.2. Written in TypeScript, runs on Node.js >= 20, communicates over stdio (Claude Code) or SSE (Claude Chat).

## Build & Run

```bash
npm install          # install deps
npm run build        # compile TypeScript -> dist/
npm run dev          # dev mode with auto-reload
npm test             # run all tests
npm run test:unit    # unit tests only
npm run test:int     # integration tests (requires ADO_PAT)
npm run lint         # eslint + prettier check
npm run lint:fix     # auto-fix lint issues
```

## Code Conventions

- **Language:** TypeScript, strict mode enabled
- **Runtime:** Node.js >= 20 (use native fetch, no axios)
- **Package manager:** npm (lockfile committed)
- **Module system:** ESM (`"type": "module"` in package.json)
- **Style:** Prettier defaults, ESLint with `@typescript-eslint/recommended`
- **Naming:**
  - Files: `kebab-case.ts`
  - Types/interfaces: `PascalCase`
  - Functions/variables: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`
- **Imports:** Use path aliases (`@/tools/...`, `@/clients/...`) configured in tsconfig
- **Error handling:** Throw typed errors that extend `McpError`. Never swallow errors silently.
- **No `any`:** Use `unknown` + type guards instead. The `any` type is banned in eslint config.

## Architecture Rules

- One tool file per API area in `src/tools/` (e.g., `work-items.ts`, `git.ts`, `pipelines.ts`)
- Each tool file exports a `register(server)` function that registers all tools for that area
- Tool handlers must:
  1. Validate inputs with Zod schemas
  2. Call the corresponding client function
  3. Return structured MCP content (not raw API responses)
- Client wrappers in `src/clients/` handle HTTP calls, auth headers, and response parsing
- Keep tool handlers thin -- business logic belongs in clients or utils

## Security Requirements -- CRITICAL

### Credential Handling
- **NEVER** log, print, or include PATs/tokens in error messages or MCP responses
- **NEVER** commit `.env` files, PATs, or any secrets to the repository
- Credentials come exclusively from environment variables, injected at runtime
- Use the `auth/` module for all authentication -- never construct auth headers directly in tool handlers

### Input Validation
- **ALL** tool inputs must be validated through Zod schemas before use
- Validate and sanitize WIQL queries to prevent injection (no raw string interpolation into queries)
- Validate project names, repo names, and IDs against expected patterns (alphanumeric, hyphens, underscores)
- Reject inputs containing path traversal patterns (`../`, `..\\`)
- Enforce maximum string lengths on all text inputs

### Output Safety
- Strip or redact any credentials, tokens, or connection strings from API responses before returning
- Do not return full error stack traces in production mode -- log them server-side, return sanitized messages
- Limit response sizes: truncate large payloads (e.g., file contents, build logs) to prevent context overflow

### Least-Privilege Principle
- Document the minimum PAT scope required for each tool in its JSDoc
- Default to read-only operations; write operations must be explicitly marked
- Destructive operations (delete work item, force-push, delete repo) must:
  - Be clearly named with destructive verbs
  - Include a confirmation parameter or pattern
  - Log the action at `warn` level

### Rate Limiting & Abuse Prevention
- Respect Azure DevOps rate limits (global and per-resource)
- Implement exponential backoff on 429 responses
- Cap concurrent requests per tool invocation
- Set reasonable timeouts on all HTTP requests (30s default)

### Dependency Security
- Pin exact dependency versions in package.json
- Run `npm audit` in CI and block on high/critical vulnerabilities
- Minimize dependencies -- prefer Node.js built-ins (native fetch, crypto, etc.)

## Testing Guidelines

- Unit tests: mock HTTP layer, test tool input validation and response shaping
- Integration tests: run against a real Azure DevOps org (gated behind `ADO_PAT` env var)
- Test files go in `tests/unit/` or `tests/integration/`, mirroring `src/` structure
- Name test files `*.test.ts`
- Every tool must have:
  - Input validation tests (valid and invalid inputs)
  - Response transformation tests
  - Error handling tests (401, 404, 429, 500)

## MCP Tool Design Guidelines

- **Descriptive tool names:** Use `ado_<area>_<action>` pattern, e.g. `ado_workitems_query`, `ado_git_get_pr`
- **Clear descriptions:** Each tool description should state what it does, required permissions, and any side effects
- **Structured inputs:** Use Zod schemas with descriptions on each field. Prefer enums over free-form strings where the API expects specific values
- **Pagination:** Tools that list resources must support `top` and `continuationToken` parameters
- **Consistent error format:** Return `isError: true` with a human-readable message on failure

## Git Workflow

- Branch naming: `feature/`, `fix/`, `chore/` prefixes
- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- PRs require passing CI (lint + test) before merge
- Squash merge to main

## Environment Setup

Copy `.env.example` to `.env` and fill in values. **Never commit `.env`.**

```
ADO_ORG_URL=https://dev.azure.com/yourorg
ADO_PAT=your-pat-here
ADO_DEFAULT_PROJECT=optional-default-project
ADO_LOG_LEVEL=info
```
