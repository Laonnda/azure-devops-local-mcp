# Azure DevOps Local MCP — Technical Manual

Architecture, build pipeline, distribution, deployment, and extension guide for azure-devops-local-mcp maintainers and platform teams.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Repository Layout](#repository-layout)
3. [Build System](#build-system)
4. [Authentication Architecture](#authentication-architecture)
5. [Adding New Tools](#adding-new-tools)
6. [Testing Strategy](#testing-strategy)
7. [Distribution — npm Package](#distribution--npm-package)
8. [Distribution — Docker Image](#distribution--docker-image)
9. [Deployment — Claude Code (stdio)](#deployment--claude-code-stdio)
10. [Deployment — Self-hosted SSE Server](#deployment--self-hosted-sse-server)
11. [Deployment — Azure Container Apps](#deployment--azure-container-apps)
12. [CI/CD Pipeline](#cicd-pipeline)
13. [Configuration Reference](#configuration-reference)
14. [Versioning and Changelog](#versioning-and-changelog)
15. [Security Considerations](#security-considerations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Claude Code (stdio)  │  Claude Chat (SSE / HTTP)   │
└──────────┬────────────┴──────────────┬──────────────┘
           │  MCP Protocol             │  MCP over HTTP
           ▼                           ▼
┌──────────────────────────────────────────────────────┐
│                    azure-devops-local-mcp server                    │
│                                                      │
│  Transport layer                                     │
│    StdioServerTransport  │  StreamableHTTPTransport  │
│                                                      │
│  McpServer (SDK)                                     │
│    registerTool() for each ADO area                  │
│                                                      │
│  Tool handlers (src/tools/*.ts)                      │
│    Zod input validation → client call → MCP response │
│                                                      │
│  HTTP clients (src/clients/*.ts)                     │
│    BaseClient: auth, retry, rate-limit, sanitize     │
│    Area clients: WikiClient, GitClient, …            │
│                                                      │
│  Auth layer (src/auth/)                              │
│    PAT  │  OAuth 2.0  │  Managed Identity            │
└──────────────────────┬───────────────────────────────┘
                       │  HTTPS  (TLS 1.2+)
                       ▼
          Azure DevOps REST API v7.1
          https://dev.azure.com/{org}/_apis/
          https://almsearch.dev.azure.com/{org}/_apis/  (search)
```

The server is intentionally stateless — no database, no session storage, no caching. Every tool call makes one or more direct ADO API requests and returns the result.

---

## Repository Layout

```
azure-devops-local-mcp/
├── src/
│   ├── index.ts              # Entry point; selects transport, calls createServer()
│   ├── server.ts             # Creates McpServer and registers all tool groups
│   ├── auth/
│   │   ├── types.ts          # AuthProvider interface
│   │   ├── pat.ts            # Personal Access Token provider
│   │   ├── oauth.ts          # OAuth 2.0 authorization-code provider
│   │   ├── managed-identity.ts  # Azure Managed Identity (IMDS) provider
│   │   └── select.ts         # Reads env vars, constructs the right provider
│   ├── clients/
│   │   ├── base-client.ts    # HTTP retry loop, auth headers, rate limiter, ETag
│   │   ├── git-client.ts
│   │   ├── pipelines-client.ts
│   │   ├── projects-client.ts
│   │   ├── search-client.ts  # Overrides orgUrl for almsearch host
│   │   ├── test-plans-client.ts
│   │   ├── wiki-client.ts
│   │   └── work-items-client.ts
│   ├── tools/
│   │   ├── git.ts
│   │   ├── pipelines.ts
│   │   ├── projects.ts
│   │   ├── search.ts
│   │   ├── test-plans.ts
│   │   ├── wiki.ts
│   │   └── work-items.ts
│   ├── validation/
│   │   ├── common.ts         # Shared Zod schemas (guidSchema, topSchema, …)
│   │   ├── pipelines.ts      # Pipeline-specific schemas
│   │   └── test-plans.ts     # Test-plan-specific schemas
│   └── utils/
│       ├── errors.ts         # Typed error classes + withErrorHandling wrapper
│       ├── logger.ts         # Structured JSON logger
│       ├── rate-limiter.ts   # Token-bucket rate limiter
│       ├── sanitize.ts       # Strips credentials from response objects
│       ├── truncate.ts       # Caps oversized payloads before returning them
│       └── version.ts        # Exposes the package.json version
├── tests/
│   ├── unit/
│   │   ├── auth/             # Auth provider selection and token handling
│   │   ├── clients/          # Client-level HTTP layer tests
│   │   ├── tools/            # Tool registration, input validation, response shape
│   │   └── utils/            # Sanitizer, rate limiter, error helpers
│   └── integration/          # Against a live ADO org (requires ADO_PAT env var)
├── documents/
│   ├── user-manual.md
│   └── technical-manual.md   # ← this file
├── scripts/
│   ├── make-mcpb.sh          # Builds the .mcpb bundle for Claude Desktop
│   └── make-release.sh       # Builds the Windows distribution ZIP
├── .github/workflows/ci.yml  # Lint, build, tests, npm audit
├── dist/                     # TypeScript output (generated, not committed)
├── manifest.json             # MCPB bundle manifest
├── setup.ps1 / setup.bat     # Windows setup scripts (shipped in the ZIP)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── LICENSE
```

---

## Build System

### TypeScript compilation

The project uses the TypeScript compiler directly — no bundler.

```bash
npm run build        # tsc → dist/
npm run dev          # tsx watch src/index.ts (no build step, hot-reload)
```

`tsconfig.json` targets ES2022 with ESM output (`"type": "module"` in `package.json`). All imports must use `.js` extensions (even when importing `.ts` source files) to satisfy Node.js ESM resolution.

### Output

`npm run build` writes compiled `.js` files to `dist/` mirroring the `src/` layout. The entry point is `dist/index.js`. The `bin` field in `package.json` maps the `azure-devops-local-mcp` CLI name to this file.

### Key npm scripts

| Script | What it runs |
|---|---|
| `npm run build` | `tsc` — compile to `dist/` |
| `npm run dev` | `tsx watch src/index.ts` — dev server with hot-reload |
| `npm test` | `vitest run` — all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:int` | Integration tests (requires `ADO_PAT`) |
| `npm run lint` | `eslint` + `prettier --check` |
| `npm run lint:fix` | Auto-fix lint and formatting |

---

## Authentication Architecture

Auth is abstracted behind the `AuthProvider` interface:

```typescript
// src/auth/types.ts
export interface AuthProvider {
  getAuthHeader(): Promise<string>;
}
```

`BaseClient` calls `getAuthHeader()` on every request. The returned string is used directly as the `Authorization` HTTP header.

### PAT (Personal Access Token)

`PatAuthProvider` encodes the PAT as Basic auth with an empty username:

```
Authorization: Basic base64(":" + pat)
```

### OAuth 2.0 (authorization code)

`OAuthAuthProvider` uses the authorization-code grant: it exchanges `ADO_AUTH_CODE` (obtained from the user's browser sign-in via the Azure AD authorize endpoint) together with `ADO_CLIENT_ID` + `ADO_CLIENT_SECRET` + `ADO_TENANT_ID` for a bearer token. `ADO_OAUTH_REDIRECT_URI` overrides the default redirect URI. Tokens are cached in memory and refreshed automatically before expiry.

### Managed Identity

`ManagedIdentityAuthProvider` calls the Azure Instance Metadata Service (IMDS) at `http://169.254.169.254/metadata/identity/oauth2/token`. This works in Azure VMs, App Service, Container Apps, and AKS pods with a managed identity assigned. Set `ADO_MI_CLIENT_ID` for a user-assigned identity; omit it to use the system-assigned identity.

### Selecting an auth provider

`selectAuthProvider(env)` in `src/auth/select.ts` reads the environment and constructs exactly one provider. Priority: PAT → OAuth → Managed Identity. Having more than one configured simultaneously throws `AuthenticationError`.

---

## Adding New Tools

Each MCP tool area follows the same three-layer pattern:

### 1. Client (`src/clients/<area>-client.ts`)

- Extend `BaseClient`
- Define raw ADO response interfaces (prefixed `Raw`)
- Define public output interfaces
- Map raw → public in functions named `map<Entity>()`
- Call `this.request<T>()` for standard requests
- Call `this.requestFull<T>()` when you need the ETag response header

```typescript
export class FooClient extends BaseClient {
  async getWidget(project: string, id: number): Promise<Widget> {
    const raw = await this.request<RawWidget>(`foo/widgets/${id}`, { project });
    return mapWidget(raw);
  }
}
```

### 2. Tool registration (`src/tools/<area>.ts`)

- Import the client and Zod schemas
- Call `server.registerTool(name, { description, inputSchema, annotations }, handler)`
- Wrap the handler with `withErrorHandling(async (params) => { ... })`
- Return `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }`

```typescript
server.registerTool(
  "ado_foo_get_widget",
  {
    description: "Get a widget by ID. Requires vso.foo PAT scope.",
    inputSchema: {
      project: projectNameSchema,
      id: z.number().int().positive(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  withErrorHandling(async ({ project, id }) => {
    const result = await client.getWidget(project, id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }),
);
```

### 3. Register in server (`src/server.ts`)

Import your `registerFooTools` function and call it inside `createServer()`.

### Checklist for new tools

- [ ] All inputs validated with Zod schemas (no raw strings passed to URLs)
- [ ] PAT scope documented in description and JSDoc
- [ ] `readOnlyHint: false` for any write/mutate operation
- [ ] Unit tests for input validation, response mapping, and at least one error case
- [ ] `sanitizeObject` called on raw API responses (automatic via `BaseClient.request`)

---

## Testing Strategy

### Unit tests

All tests live in `tests/unit/` and use Vitest. They mock `globalThis.fetch` directly:

```typescript
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  headers: new Headers({ ETag: '"abc123"' }),
  json: () => Promise.resolve({ ... }),
});
```

**Conventions:**
- `beforeEach` saves `originalFetch`; `afterEach` restores it and calls `vi.restoreAllMocks()`
- Test files mirror `src/` structure: `src/clients/git-client.ts` → `tests/unit/clients/git-client.test.ts`
- Every client function needs: happy path, missing/optional fields, at least 401 and 404 error cases
- Every tool needs: registration test, invalid input rejection, shape of successful output

### Integration tests

`tests/integration/` tests run against a live Azure DevOps organisation. They are gated behind the `ADO_PAT` environment variable and skipped in CI unless explicitly enabled.

Run them locally:

```bash
ADO_ORG_URL="https://dev.azure.com/your-org" \
ADO_PAT="your-pat" \
ADO_DEFAULT_PROJECT="YourProject" \
npm run test:int
```

---

## Distribution — npm Package

> **Status:** the package is **not yet published to npm** — publishing is on the
> roadmap (see README). This section describes the process for when it happens.
> Today, users install via the `.mcpb` bundle (Claude Desktop), the Windows ZIP,
> or from source.

### Prepare for publishing

1. Bump the version in `package.json` following semver
2. Ensure `dist/` is current: `npm run build`
3. Confirm `files` field in `package.json` is set (or add `.npmignore` to exclude `tests/`, `src/`, `documents/`):

```json
"files": ["dist", "README.md", "LICENSE"]
```

4. Dry-run to see what will be published:

```bash
npm pack --dry-run
```

### Publish

```bash
# Log in once
npm login

# Publish to the public registry
npm publish

# Or to a private registry / GitHub Packages
npm publish --registry https://npm.pkg.github.com
```

### Installing from the registry

Once published, users install with:

```bash
npm install -g azure-devops-local-mcp
```

And reference the binary in Claude Code settings:

```json
{
  "mcpServers": {
    "ado": {
      "command": "azure-devops-local-mcp",
      "env": { "ADO_ORG_URL": "...", "ADO_PAT": "..." }
    }
  }
}
```

---

## Distribution — Docker Image

### Dockerfile

Create a `Dockerfile` in the project root:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3100
CMD ["node", "dist/index.js", "--transport", "http"]
```

### Build and push

```bash
docker build -t your-registry/azure-devops-local-mcp:0.1.0 .
docker push your-registry/azure-devops-local-mcp:0.1.0
```

### Run the container

```bash
docker run -d \
  -p 3100:3100 \
  -e ADO_ORG_URL="https://dev.azure.com/your-org" \
  -e ADO_PAT="your-pat" \
  -e ADO_DEFAULT_PROJECT="MyProject" \
  your-registry/azure-devops-local-mcp:0.1.0
```

---

## Deployment — Claude Code (stdio)

Claude Code spawns the server as a child process and communicates over stdin/stdout. The process lifecycle is managed by Claude Code; you do not need a service manager.

### How Claude Code locates the config

Claude Code reads MCP server configuration from a file named **`.mcp.json`**. It searches from the current working directory upward through parent folders and merges all `.mcp.json` files it finds. The server is started automatically — no separate process management is needed.

### Personal machine (single user)

Create `.mcp.json` in a folder that is a parent of all your ADO-related work, for example `~/Documents/projects/.mcp.json`. This makes the server available to every project under that directory without repeating the config.

```json
{
  "mcpServers": {
    "ado": {
      "command": "node",
      "args": ["/opt/azure-devops-local-mcp/dist/index.js"],
      "env": {
        "ADO_ORG_URL": "https://dev.azure.com/your-org",
        "ADO_PAT": "the-users-pat",
        "ADO_DEFAULT_PROJECT": "MyProject"
      }
    }
  }
}
```

The PAT is stored as plain text in this file. Place it outside any git repository and set permissions to `chmod 600 .mcp.json`.

### Team / shared repository

Teams can commit a `.mcp.json` at the repository root so all developers get the server config without manual setup. **Do not include the PAT** in the committed file — each developer adds their own PAT locally.

Committed `.mcp.json` (no secrets):

```json
{
  "mcpServers": {
    "ado": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "ADO_ORG_URL": "https://dev.azure.com/your-org",
        "ADO_DEFAULT_PROJECT": "MyProject"
      }
    }
  }
}
```

Each developer then creates a personal **`.mcp.json`** in a parent folder (outside the repo) that adds only the PAT:

```json
{
  "mcpServers": {
    "ado": {
      "env": {
        "ADO_PAT": "their-personal-pat"
      }
    }
  }
}
```

Claude Code merges both files, so the server gets all required environment variables without any PAT in version control. Add `.mcp.json` to the repo's `.gitignore` to prevent accidental commits of personal overrides.

---

## Deployment — Self-hosted SSE Server

For Claude Chat or any HTTP-based MCP client.

### systemd (Linux)

Create `/etc/systemd/system/azure-devops-local-mcp.service`:

```ini
[Unit]
Description=Azure DevOps Local MCP Server
After=network.target

[Service]
Type=simple
User=azure-devops-local-mcp
WorkingDirectory=/opt/azure-devops-local-mcp
ExecStart=/usr/bin/node dist/index.js --transport http
Restart=on-failure
RestartSec=5

Environment=ADO_ORG_URL=https://dev.azure.com/your-org
Environment=ADO_DEFAULT_PROJECT=MyProject
Environment=PORT=3100
EnvironmentFile=/etc/azure-devops-local-mcp/secrets.env

[Install]
WantedBy=multi-user.target
```

Store the PAT in `/etc/azure-devops-local-mcp/secrets.env` (mode 0600, owned by `azure-devops-local-mcp`):

```
ADO_PAT=your-pat-here
```

Enable and start:

```bash
systemctl enable azure-devops-local-mcp
systemctl start azure-devops-local-mcp
systemctl status azure-devops-local-mcp
```

### Reverse proxy (nginx)

If you want TLS termination or path-based routing:

```nginx
server {
    listen 443 ssl;
    server_name azure-devops-local-mcp.internal.company.com;

    ssl_certificate     /etc/ssl/certs/azure-devops-local-mcp.crt;
    ssl_certificate_key /etc/ssl/private/azure-devops-local-mcp.key;

    location / {
        proxy_pass         http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header   Connection "";
        proxy_buffering    off;            # required for SSE streaming
        proxy_read_timeout 300s;
    }
}
```

---

## Deployment — Azure Container Apps

Managed Identity is the recommended authentication method when running in Azure.

### 1. Create a managed identity

```bash
az identity create \
  --name azure-devops-local-mcp-identity \
  --resource-group my-rg
```

### 2. Grant the identity access to Azure DevOps

In Azure DevOps: **Organisation Settings → Users** → add the managed identity's service principal as a user with the appropriate access level.

### 3. Container App definition

```bash
az containerapp create \
  --name azure-devops-local-mcp \
  --resource-group my-rg \
  --environment my-env \
  --image your-registry/azure-devops-local-mcp:0.1.0 \
  --target-port 3100 \
  --ingress external \
  --user-assigned-identity /subscriptions/.../providers/Microsoft.ManagedIdentity/userAssignedIdentities/azure-devops-local-mcp-identity \
  --env-vars \
      ADO_ORG_URL="https://dev.azure.com/your-org" \
      ADO_DEFAULT_PROJECT="MyProject" \
      ADO_USE_MANAGED_IDENTITY="true" \
      ADO_MI_CLIENT_ID="<identity-client-id>"
```

No PAT required — the server will obtain a bearer token from IMDS automatically.

### Health check

The HTTP server exposes a health endpoint:

```
GET /health
→ { "status": "ok", "server": "azure-devops-local-mcp", "version": "0.2.0" }
```

Configure Container Apps (or any load balancer) to probe this path.

---

## CI/CD Pipeline

The actual workflow (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request:

- **`ci` job** — matrix on Node 20 and 22: `npm ci`, lint, full test suite, build, and `npm audit --audit-level=high`.
- **`integration` job** — runs `npm run test:int` against a live Azure DevOps organisation, gated behind the repository variable `RUN_INTEGRATION=true` and the secrets `ADO_ORG_URL`, `ADO_PAT`, `ADO_TEST_PROJECT`.

There is **no automated publish step** — releases are built locally (`scripts/make-mcpb.sh`, `scripts/make-release.sh`) and attached to a GitHub release by hand. If npm publishing is adopted later (see the Distribution section), a tag-triggered `publish` job with `npm publish` and an `NPM_TOKEN` secret is the natural extension.

---

## Versioning and Changelog

The project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/):

| Commit prefix | Version bump |
|---|---|
| `fix:` | Patch |
| `feat:` | Minor |
| `feat!:` or `BREAKING CHANGE:` | Major |

To cut a release:

1. Update `version` in `package.json`
2. Commit: `chore: bump version to 0.2.0`
3. Tag: `git tag v0.2.0 && git push --tags`
4. Build the release artifacts (`scripts/make-mcpb.sh`, `scripts/make-release.sh`) and attach them to a GitHub release for the tag

---

## Security Considerations

### Credential handling

- PATs and OAuth tokens are **never logged** — `sanitizeObject` in `src/utils/sanitize.ts` strips common credential field names from all API responses before they reach the MCP layer
- The `PatAuthProvider` encodes the token at construction time and only exposes the encoded `Basic …` header string
- OAuth tokens are stored only in process memory; they are not written to disk

### Input validation

All tool inputs pass through Zod schemas before reaching the HTTP layer. The schemas enforce:

- Maximum string lengths on all text fields
- Regex patterns on structured identifiers (GUIDs, project names, wiki paths)
- Enum constraints on fields that accept only known values
- WIQL query validation: blocked SQL-mutation patterns and a 2000-character limit

### Network

- All ADO API calls use HTTPS; there is no option to downgrade to HTTP
- The server sets a 30-second timeout on every request
- A token-bucket rate limiter (`src/utils/rate-limiter.ts`) limits to 60 calls/minute by default, with exponential back-off on 429 responses

### Least privilege

The PAT scope required for each tool is documented in the tool's description (visible to Claude) and in the Tool Reference section of the user manual. Grant only the scopes you need.

### Multi-tenant considerations

If one azure-devops-local-mcp instance serves multiple users or projects:

- Use OAuth 2.0 with per-user token exchange rather than a shared PAT
- Consider running one instance per tenant to provide isolation at the process boundary
- The server is stateless, so horizontal scaling behind a load balancer is safe
- Never share a PAT across tenants — a PAT grants the same access as the user who created it
