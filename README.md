# ado-mcp — Azure DevOps for Claude

[![CI](https://github.com/Laonnda/ado-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Laonnda/ado-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Download for Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-.mcpb%20install-orange)](https://github.com/Laonnda/ado-mcp/releases/latest)

A local MCP (Model Context Protocol) server that connects **Claude Desktop, Claude Code, and Claude Chat** to your Azure DevOps organisation — query work items, review pull requests, trigger pipelines, search code, manage test plans, and update wikis using plain language.

One-file install for Claude Desktop. Runs entirely on your machine.

## Why this server?

Microsoft maintains an official [azure-devops-mcp](https://github.com/microsoft/azure-devops-mcp)
server, and if you use VS Code with GitHub Copilot against their hosted remote
server, it is a great choice. This project exists for a different scenario:

- **Claude-first.** One-file MCPB install for Claude Desktop (no Node.js required),
  SSE mode for Claude Chat, and setup scripts and manuals written for Claude Code.
  The official server is built VS Code-first and ships via npm only.
- **Local-first, by design.** Microsoft is moving development to their hosted
  remote server and recommends local users plan a migration. This server is and
  stays a local process: your PAT and your traffic never route through a
  third-party MCP endpoint — which matters in regulated and security-conscious
  environments.
- **Simple auth.** One PAT in an environment variable or the Claude Desktop
  config. No Azure CLI, no interactive browser sign-in required.
- **Small supply chain.** Three runtime dependencies (`@modelcontextprotocol/sdk`,
  `express`, `zod`) against the official server's thirteen — easier to audit,
  smaller attack surface.

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

1. Download `ado-mcp-<version>.mcpb` from the [latest release](https://github.com/Laonnda/ado-mcp/releases/latest).
2. Open the file with Claude Desktop — double-click it, or drag it into **Settings → Extensions**.
3. Fill in the configuration fields:
   - **Azure DevOps organization URL** (required), e.g. `https://dev.azure.com/yourorg`
   - **Personal Access Token** (required) — see [Personal Access Token](#personal-access-token) below for scopes. The token is masked and stored securely by Claude Desktop.
   - **Default project** (optional)
   - **Log level** (optional, default `info`)
4. Enable the extension. No restart or manual config file editing is needed.

To build the bundle from source, run `bash scripts/make-mcpb.sh` — it outputs `distribution/ado-mcp-<version>.mcpb`.

## Install — Claude Code (from source)

The package is not yet published to npm (see [Roadmap](#roadmap)). Clone and build:

```
git clone https://github.com/Laonnda/ado-mcp.git
cd ado-mcp
npm install
npm run build
npm install -g .
```

Then create a `.mcp.json` file in your project folder (or a parent folder to share it across projects):

```json
{
  "mcpServers": {
    "ado": {
      "command": "ado-mcp",
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

## Claude Chat (Web) — SSE mode

Start the server locally in HTTP mode and connect Claude Chat to it:

```
ado-mcp --transport http
```

Then add `http://localhost:3100/mcp` as an MCP server in Claude Chat settings.

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
| `ADO_PAT` | Yes | Personal Access Token |
| `ADO_DEFAULT_PROJECT` | No | Default project name |
| `ADO_LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |

## Roadmap

| Feature | Status |
|---|---|
| Publish to npm (`npx -y ado-mcp` one-line setup) | Planned |
| Submit to the MCP registry and the Claude Desktop extensions directory | Planned |
| PR reviewer votes (approve / wait for author / reject) | Under consideration |

## Documentation

- [User manual](documents/user-manual.md) — written for non-developers setting up Claude with Azure DevOps
- [Technical manual](documents/technical-manual.md) — architecture, tool reference, and development guide

## License

MIT
