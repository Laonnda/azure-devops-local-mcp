# ado-mcp

[![CI](https://github.com/Laonnda/ado-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Laonnda/ado-mcp/actions/workflows/ci.yml)

MCP (Model Context Protocol) server for Azure DevOps. Connects Claude Code and Claude Chat to your Azure DevOps organisation — query work items, review pull requests, trigger pipelines, search code, and manage wikis using plain language.

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

## Installation

```
npm install -g ado-mcp
```

Requires Node.js 20 or later.

## Setup — Claude Desktop

Add the following to your Claude Desktop config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

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

Restart Claude Desktop after saving.

## Setup — Claude Code

Create a `.mcp.json` file in your project folder (or a parent folder to share it across projects):

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

## Claude Chat (Web) — SSE mode

Start the server locally and connect Claude Chat to it:

```
ado-mcp --transport http
```

Then add `http://localhost:3100/mcp` as an MCP server in Claude Chat settings.

## License

MIT
