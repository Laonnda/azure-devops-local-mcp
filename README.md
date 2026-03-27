# ado-mcp

An MCP (Model Context Protocol) server for Azure DevOps, enabling Claude Code and Claude Chat to interact with Azure DevOps services through a secure, typed interface.

## Overview

This connector exposes Azure DevOps REST API v7.2 operations as MCP tools, allowing AI assistants to query work items, manage repositories, trigger pipelines, and more -- all within a controlled, permission-scoped context.

### Supported API Areas

| Area | Operations | Description |
|------|-----------|-------------|
| **Work Item Tracking** | CRUD, WIQL queries, linking | Create, read, update, and query work items |
| **Git Repositories** | Repos, branches, commits, PRs | Manage source code, pull requests, and code reviews |
| **Pipelines / Build** | Definitions, runs, logs, artifacts | Trigger and monitor CI/CD pipelines |
| **Release** | Definitions, deployments, approvals | Manage release pipelines and deployments |
| **Boards & Backlogs** | Board config, cards, capacity | Interact with Agile boards and backlog management |
| **Test Plans** | Plans, suites, cases, results | Manage test planning and execution |
| **Wiki** | Pages, attachments | Read and update wiki content |
| **Search** | Code search, work item search | Full-text search across the project |
| **Artifacts / Feeds** | Feeds, packages (NuGet, npm, etc.) | Package management across feed types |
| **Identity & Permissions** | Users, groups, ACLs | Query identity and access control |
| **Notifications** | Subscriptions, events | Manage event subscriptions |
| **Audit** | Audit logs, streams | Query audit and diagnostic logs |

## Architecture

```
Claude Code / Chat
       |
       v
  MCP Protocol (stdio / SSE)
       |
       v
  ado-mcp server
       |
       +-- Auth layer (PAT / OAuth / Managed Identity)
       +-- Rate limiter
       +-- Input validation & sanitization
       +-- Tool handlers (one per API area)
       |
       v
  Azure DevOps REST API v7.2
  https://dev.azure.com/{organization}/_apis/
```

## Prerequisites

- Node.js >= 20
- An Azure DevOps organization
- A Personal Access Token (PAT) or OAuth app registration with appropriate scopes

## Installation

```bash
npm install
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADO_ORG_URL` | Yes | Organization URL, e.g. `https://dev.azure.com/myorg` |
| `ADO_PAT` | Yes* | Personal Access Token (*unless using OAuth/Managed Identity) |
| `ADO_DEFAULT_PROJECT` | No | Default project name for operations |
| `ADO_LOG_LEVEL` | No | Logging level: `debug`, `info`, `warn`, `error` (default: `info`) |

**Important:** Never commit PATs or secrets to the repository. Use `.env` files (already in `.gitignore`) or a secrets manager.

### Claude Code Integration

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "node",
      "args": ["path/to/ado-mcp/dist/index.js"],
      "env": {
        "ADO_ORG_URL": "https://dev.azure.com/yourorg",
        "ADO_PAT": "${ADO_PAT}"
      }
    }
  }
}
```

### Claude Chat (Web) Integration

For SSE transport, start the server with:

```bash
npm run start:sse -- --port 3100
```

## Usage Examples

Once connected, Claude can use the MCP tools:

```
"List all active bugs in the Backend project"
"Create a work item: Task titled 'Add caching layer' assigned to @alice"
"Show me the latest pipeline run for the main branch"
"Get the diff for PR #142"
"Search for references to 'AuthMiddleware' across all repos"
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Project Structure

```
ado-mcp/
  src/
    index.ts              # Entry point, MCP server setup
    auth/                 # Authentication providers (PAT, OAuth, MI)
    tools/                # MCP tool definitions, one file per API area
      work-items.ts
      git.ts
      pipelines.ts
      ...
    clients/              # Azure DevOps REST API client wrappers
    validation/           # Input validation schemas (zod)
    utils/                # Rate limiting, logging, error handling
  tests/
    unit/
    integration/
  dist/                   # Compiled output
  .env.example            # Template for environment variables
```

## Security

This project follows strict security practices for handling Azure DevOps credentials and data:

- **No secrets in code or logs** -- PATs and tokens are never logged or included in error messages
- **Input validation** -- All tool inputs are validated with Zod schemas before reaching the API
- **Least-privilege scoping** -- Documentation specifies minimum required PAT scopes per tool
- **No credential storage** -- Credentials are passed via environment variables only
- **Rate limiting** -- Built-in rate limiting to prevent abuse and respect API quotas
- **Read-preference** -- Destructive operations (delete, force-push) require explicit confirmation patterns

See [CLAUDE.md](./CLAUDE.md) for full security and development guidelines.

## License

MIT
