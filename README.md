# azure-devops-local-mcp — Azure DevOps for Claude

[![CI](https://github.com/Laonnda/azure-devops-local-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Laonnda/azure-devops-local-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Download for Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-.mcpb%20install-orange)](https://github.com/Laonnda/azure-devops-local-mcp/releases/latest)

A local MCP (Model Context Protocol) server that connects **Claude Desktop, Claude Code, and Claude Chat** to your Azure DevOps organisation — query work items, review pull requests, trigger pipelines, search code, manage test plans, and update wikis using plain language.

One-file install for Claude Desktop. Runs entirely on your machine.

## Why this server?

Microsoft maintains an official [azure-devops-mcp](https://github.com/microsoft/azure-devops-mcp)
server, and if you use VS Code with GitHub Copilot against their hosted remote
server, it is a great choice. This project exists for a different scenario:

- **Claude-first.** One-file MCPB install for Claude Desktop (no Node.js required),
  a hardened local HTTP mode, and setup scripts and manuals written for Claude Code.
  The official server is built VS Code-first and ships via npm only.
- **Local-first, by design.** Microsoft is moving development to their hosted
  remote server and recommends local users plan a migration. This server is and
  stays a local process: your PAT and your traffic never route through a
  third-party MCP endpoint — which matters in regulated and security-conscious
  environments.
- **Simple auth.** One PAT in an environment variable or the Claude Desktop
  config. No Azure CLI, no interactive browser sign-in required.
- **Small supply chain.** Three runtime dependencies (`@modelcontextprotocol/sdk`,
  `express`, `zod`) against the official server's thirteen (as of September 2026) —
  easier to audit, smaller attack surface.

> This project is not affiliated with or endorsed by Microsoft. "Azure DevOps"
> is a Microsoft trademark; the name is used descriptively. For the official
> server, see [microsoft/azure-devops-mcp](https://github.com/microsoft/azure-devops-mcp).

If you need Advanced Security alerts, team capacity planning, or the hosted
remote server, use the official one. If you want a lean local server for Claude,
you are in the right place.

## Supported areas

| Area | What you can do |
|---|---|
| **Work Items** | Create, read, update, query via WIQL |
| **Git / Pull Requests** | List repos, list and read PRs, add comments |
| **Pipelines** | List definitions, see run status, trigger builds, fetch logs |
| **Code Search** | Full-text search across all repositories |
| **Wiki** | Read and update wiki pages |
| **Projects** | List all projects in the organisation |
| **Test Plans** | List, create, and get test plans; manage suites; add and list test cases |

## Install — Claude Desktop (recommended)

The prebuilt MCP Bundle (`.mcpb`) is the easiest way in. One file covers macOS, Windows, and Linux, and no Node.js installation is required — Claude Desktop runs the server with its bundled runtime.

1. Download `azure-devops-local-mcp-<version>.mcpb` from the [latest release](https://github.com/Laonnda/azure-devops-local-mcp/releases/latest).
2. Open the file with Claude Desktop — double-click it, or drag it into **Settings → Extensions**.
3. Fill in the configuration fields:
   - **Azure DevOps organization URL** (required), e.g. `https://dev.azure.com/yourorg`
   - **Personal Access Token** (required) — see [Personal Access Token](#personal-access-token) below for scopes. The token is masked and stored securely by Claude Desktop.
   - **Default project** (optional)
   - **Log level** (optional, default `info`)
4. Enable the extension. No restart or manual config file editing is needed.

To build the bundle from source, run `bash scripts/make-mcpb.sh` — it outputs `distribution/azure-devops-local-mcp-<version>.mcpb`.

## Install — Claude Code (from source)

The package is not yet published to npm (see [Roadmap](#roadmap)). Clone and build:

```
git clone https://github.com/Laonnda/azure-devops-local-mcp.git
cd azure-devops-local-mcp
npm install
npm run build
npm install -g .
```

Then create a `.mcp.json` file in your project folder (or a parent folder to share it across projects):

```json
{
  "mcpServers": {
    "ado": {
      "command": "azure-devops-local-mcp",
      "env": {
        "ADO_ORG_URL": "https://dev.azure.com/your-org",
        "ADO_PAT": "your-pat-here",
        "ADO_DEFAULT_PROJECT": "MyProject"
      }
    }
  }
}
```

Run `/mcp` inside Claude Code to confirm the connection.

On Windows, `setup.bat` / `setup.ps1` automate the Claude Desktop JSON-config route if you prefer a scripted install over the MCPB bundle.

## HTTP mode (advanced)

The server can also run as a local HTTP endpoint for MCP clients that connect over HTTP:

```
azure-devops-local-mcp --transport http
```

It binds to `127.0.0.1:3100` and serves MCP at `http://127.0.0.1:3100/mcp`. Note that
the hosted claude.ai cannot reach a localhost URL: to use this server with Claude
Chat on the web you would need to expose it through your own tunnel or reverse
proxy. If you do, set `ADO_HTTP_TOKEN` — the server refuses to bind beyond
loopback without it, and with it every `/mcp` request must carry
`Authorization: Bearer <token>`. Treat that setup as advanced: the token guards
a PAT with real permissions.

## Personal Access Token

Create a PAT in Azure DevOps (profile icon → Personal access tokens) with only the scopes you need:

| Feature | Scope |
|---|---|
| Work items (read) | Work Items — Read |
| Work items (create/update) | Work Items — Read & Write |
| Repos and PRs (read) | Code — Read |
| PR comments (write) | Code — Read & Write |
| Pipelines (read) | Build — Read |
| Trigger pipeline runs | Build — Read & Execute |
| Code search | Code — Read |
| Wiki (read) | Wiki — Read |
| Wiki (write) | Wiki — Read & Write |
| Test plans, suites, test cases (read) | Test Management — Read |
| Test plans, suites, test cases (create/update) | Test Management — Read & Write |

## Configuration

| Variable | Required | Description |
|---|---|---|
| `ADO_ORG_URL` | Yes | Organisation URL, e.g. `https://dev.azure.com/myorg` |
| `ADO_PAT` | Yes* | Personal Access Token |
| `ADO_DEFAULT_PROJECT` | No | Default project name |
| `ADO_LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |
| `ADO_API_VERSION` | No | Azure DevOps REST API version, e.g. `7.2-preview` (default) or `7.1` |
| `ADO_RATE_LIMIT` | No | Max API requests per minute (default: `60`) |
| `ADO_READ_ONLY` | No | `true` registers only read tools — no writes possible |
| `PORT` | No | HTTP mode only: listen port (default: `3100`) |
| `ADO_HTTP_HOST` | No | HTTP mode only: bind address (default: `127.0.0.1`; non-loopback requires `ADO_HTTP_TOKEN`) |
| `ADO_HTTP_TOKEN` | No | HTTP mode only: require `Authorization: Bearer <token>` on `/mcp` |

\* PAT is the simplest method. OAuth 2.0 and Azure Managed Identity are also
supported — see [`.env.example`](.env.example) for the alternative variables.

## Security model

- **Your PAT stays local.** The server is a local process; credentials live in
  environment variables or the Claude Desktop extension config and are never
  logged. API responses are scrubbed for credential-shaped fields before they
  reach the model.
- **Treat Azure DevOps content as untrusted input.** Work item text, PR
  comments, and wiki pages written by others are returned to the model verbatim
  and can contain adversarial instructions ("prompt injection"). If your PAT
  has write scopes, a hostile work item can try to steer the model into using
  them. Give the PAT the narrowest scopes you can, and prefer read-only tokens
  for browsing workflows.
- **Read-only mode.** Set `ADO_READ_ONLY=true` and the server only registers
  read tools — no writes are possible regardless of what the model is asked
  to do. Recommended wherever you don't actively need writes.
- **HTTP mode is loopback-only by default** and requires `ADO_HTTP_TOKEN` to
  bind wider. See [HTTP mode](#http-mode-advanced).

## Roadmap

| Feature | Status |
|---|---|
| Publish to npm (`npx -y azure-devops-local-mcp` one-line setup) | Planned |
| Submit to the MCP registry and the Claude Desktop extensions directory | Planned |
| PR reviewer votes (approve / wait for author / reject) | Under consideration |

## Documentation

- [User manual](documents/user-manual.md) — written for non-developers setting up Claude with Azure DevOps
- [Technical manual](documents/technical-manual.md) — architecture, tool reference, and development guide

## License

MIT
