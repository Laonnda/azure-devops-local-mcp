# ADO-MCP Technical Manual

Architecture, build pipeline, distribution, deployment, and extension guide for ado-mcp maintainers and platform teams.

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
│                    ado-mcp server                    │
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
ado-mcp/
├── src/
│   ├── index.ts              # Entry point; selects transport, calls createServer()
│   ├── server.ts             # Creates McpServer and registers all tool groups
│   ├── auth/
│   │   ├── types.ts          # AuthProvider interface
│   │   ├── pat.ts            # Personal Access Token provider
│   │   ├── oauth.ts          # OAuth 2.0 client-credentials provider
│   │   ├── managed-identity.ts  # Azure Managed Identity (IMDS) provider
│   │   └── select.ts         # Reads env vars, constructs the right provider
│   ├── clients/
│   │   ├── base-client.ts    # HTTP retry loop, auth headers, rate limiter, ETag
│   │   ├── git-client.ts
│   │   ├── pipelines-client.ts
│   │   ├── projects-client.ts
│   │   ├── search-client.ts  # Overrides orgUrl for almsearch host
│   │   ├── wiki-client.ts
│   │   └── work-items-client.ts
│   ├── tools/
│   │   ├── git.ts
│   │   ├── pipelines.ts
│   │   ├── projects.ts
│   │   ├── search.ts
│   │   ├── wiki.ts
│   │   └── work-items.ts
│   ├── validation/
│   │   ├── common.ts         # Shared Zod schemas (guidSchema, topSchema, …)
│   │   └── pipelines.ts      # Pipeline-specific schemas
│   └── utils/
│       ├── errors.ts         # Typed error classes + withErrorHandling wrapper
│       ├── logger.ts         # Structured JSON logger
│       ├── rate-limiter.ts   # Token-bucket rate limiter
│       └── sanitize.ts       # Strips credentials from response objects
├── tests/
│   ├── unit/
│   │   ├── clients/          # Client-level HTTP layer tests
│   │   └── tools/            # Tool registration, input validation, response shape
│   └── integration/          # Against a live ADO org (requires ADO_PAT env var)
├── documents/
│   ├── user-manual.md
│   └── technical-manual.md   # ← this file
├── dist/                     # TypeScript output (generated, not committed)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── CLAUDE.md                 # Development guidelines for AI-assisted work
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

`npm run build` writes compiled `.js` files to `dist/` mirroring the `src/` layout. The entry point is `dist/index.js`. The `bin` field in `package.json` maps the `ado-mcp` CLI name to this file.

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

### OAuth 2.0 (client credentials)

`OAuthAuthProvider` exchanges `ADO_CLIENT_ID` + `ADO_CLIENT_SECRET` + `ADO_TENANT_ID` for a bearer token via the Azure AD token endpoint. Tokens are cached in memory and refreshed automatically before expiry.

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
npm install -g ado-mcp
```

And reference the binary in Claude Code settings:

```json
{
  "mcpServers": {
    "ado": {
      "command": "ado-mcp",
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
docker build -t your-registry/ado-mcp:0.1.0 .
docker push your-registry/ado-mcp:0.1.0
```

### Run the container

```bash
docker run -d \
  -p 3100:3100 \
  -e ADO_ORG_URL="https://dev.azure.com/your-org" \
  -e ADO_PAT="your-pat" \
  -e ADO_DEFAULT_PROJECT="MyProject" \
  your-registry/ado-mcp:0.1.0
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
      "args": ["/opt/ado-mcp/dist/index.js"],
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

Create `/etc/systemd/system/ado-mcp.service`:

```ini
[Unit]
Description=ADO MCP Server
After=network.target

[Service]
Type=simple
User=ado-mcp
WorkingDirectory=/opt/ado-mcp
ExecStart=/usr/bin/node dist/index.js --transport http
Restart=on-failure
RestartSec=5

Environment=ADO_ORG_URL=https://dev.azure.com/your-org
Environment=ADO_DEFAULT_PROJECT=MyProject
Environment=PORT=3100
EnvironmentFile=/etc/ado-mcp/secrets.env

[Install]
WantedBy=multi-user.target
```

Store the PAT in `/etc/ado-mcp/secrets.env` (mode 0600, owned by `ado-mcp`):

```
ADO_PAT=your-pat-here
```

Enable and start:

```bash
systemctl enable ado-mcp
systemctl start ado-mcp
systemctl status ado-mcp
```

### Reverse proxy (nginx)

If you want TLS termination or path-based routing:

```nginx
server {
    listen 443 ssl;
    server_name ado-mcp.internal.company.com;

    ssl_certificate     /etc/ssl/certs/ado-mcp.crt;
    ssl_certificate_key /etc/ssl/private/ado-mcp.key;

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
  --name ado-mcp-identity \
  --resource-group my-rg
```

### 2. Grant the identity access to Azure DevOps

In Azure DevOps: **Organisation Settings → Users** → add the managed identity's service principal as a user with the appropriate access level.

### 3. Container App definition

```bash
az containerapp create \
  --name ado-mcp \
  --resource-group my-rg \
  --environment my-env \
  --image your-registry/ado-mcp:0.1.0 \
  --target-port 3100 \
  --ingress external \
  --user-assigned-identity /subscriptions/.../providers/Microsoft.ManagedIdentity/userAssignedIdentities/ado-mcp-identity \
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
→ { "status": "ok", "server": "ado-mcp", "version": "0.1.0" }
```

Configure Container Apps (or any load balancer) to probe this path.

---

## CI/CD Pipeline

Example GitHub Actions workflow (`.github/workflows/ci.yml`):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm run test:unit

  publish:
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

For Docker publishing, add a step after `npm run build`:

```yaml
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: |
          docker build -t ghcr.io/${{ github.repository }}:${{ github.ref_name }} .
          docker push ghcr.io/${{ github.repository }}:${{ github.ref_name }}
```

---

## Configuration Reference

All configuration is via environment variables. None have defaults that connect to external systems — the server will not start without at minimum `ADO_ORG_URL` and one auth method.

| Variable | Required | Description |
|---|---|---|
| `ADO_ORG_URL` | **Yes** | Azure DevOps organisation URL, e.g. `https://dev.azure.com/contoso` |
| `ADO_PAT` | One of three | Personal Access Token |
| `ADO_CLIENT_ID` | One of three | OAuth 2.0 application (client) ID |
| `ADO_CLIENT_SECRET` | With CLIENT_ID | OAuth 2.0 client secret |
| `ADO_TENANT_ID` | With CLIENT_ID | Azure AD tenant ID |
| `ADO_USE_MANAGED_IDENTITY` | One of three | Set to `true` to use Azure Managed Identity |
| `ADO_MI_CLIENT_ID` | No | Client ID of a user-assigned managed identity |
| `ADO_DEFAULT_PROJECT` | No | Project name used when a tool doesn't receive an explicit `project` input |
| `ADO_LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` (default: `info`) |
| `PORT` | No | HTTP port for SSE transport (default: `3100`) |

### Transport flags (CLI)

| Flag | Description |
|---|---|
| *(none)* | Stdio transport — default for Claude Code |
| `--transport http` | HTTP/SSE transport — for Claude Chat and web clients |

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
4. CI publishes automatically on tag push (see CI/CD section above)

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

If one ado-mcp instance serves multiple users or projects:

- Use OAuth 2.0 with per-user token exchange rather than a shared PAT
- Consider running one instance per tenant to provide isolation at the process boundary
- The server is stateless, so horizontal scaling behind a load balancer is safe
- Never share a PAT across tenants — a PAT grants the same access as the user who created it
