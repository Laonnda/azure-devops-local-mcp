# Azure DevOps Local MCP — User Manual

Connect Claude Code and Claude Chat to your Azure DevOps organisation. Once set up, you can ask Claude in plain language to look up work items, review pull requests, trigger pipelines, search code, and more — without opening a browser or writing anything technical yourself.

---

## Table of Contents

1. [What is azure-devops-local-mcp?](#what-is-azure-devops-local-mcp)
2. [What you need before you start](#what-you-need-before-you-start)
3. [Installing azure-devops-local-mcp](#installing-azure-devops-local-mcp)
4. [Connecting to Claude Code](#connecting-to-claude-code)
5. [Connecting to Claude Chat (Web)](#connecting-to-claude-chat-web)
6. [Tool Reference](#tool-reference)
7. [Example Conversations](#example-conversations)
8. [Troubleshooting](#troubleshooting)

---

## What is azure-devops-local-mcp?

azure-devops-local-mcp is a small background program that lets Claude talk to your Azure DevOps organisation. Instead of opening the Azure DevOps website, you just describe what you want in plain language and Claude takes care of the rest.

What you can do:

| Area | What you can do |
|---|---|
| **Work Items** | Create, read, update, query via WIQL |
| **Git / Pull Requests** | List repos, list and read PRs, add comments |
| **Pipelines** | List definitions, see run status, trigger a build, fetch logs |
| **Code Search** | Full-text search across all repositories |
| **Wiki** | Read and update wiki pages |
| **Projects** | List all projects in the organisation |
| **Test Plans** | List, create, and get test plans; manage suites; add and list test cases |

---

## What you need before you start

- **Node.js** — a free runtime that azure-devops-local-mcp runs on. Download and install it from [https://nodejs.org](https://nodejs.org) (choose the LTS version). Just run the installer and click through — no configuration needed.
- **Claude Code** or access to **claude.ai** — whichever you plan to use.
- An **Azure DevOps account** with access to your organisation.

---

## Installing azure-devops-local-mcp

### Easiest: the MCPB bundle (Claude Desktop, all platforms)

If you use **Claude Desktop**, you do not need Node.js or a setup script:

1. Download `azure-devops-local-mcp-<version>.mcpb` from the [GitHub releases page](https://github.com/Laonnda/azure-devops-local-mcp/releases/latest).
2. Double-click the file, or drag it into Claude Desktop **Settings → Extensions**.
3. Fill in your Azure DevOps organization URL and Personal Access Token, then enable the extension.

That is the whole installation. The sections below cover the alternative ZIP-based setup for Windows and the Claude Code / Claude Chat setups.

### Alternative: the Windows ZIP

Download `azure-devops-local-mcp-windows-x.x.x.zip` from the GitHub releases page.

1. **Install Node.js** if you have not already — download the LTS installer from [https://nodejs.org](https://nodejs.org) and click through with all defaults.

2. **Extract the ZIP** to a permanent folder, for example `C:\tools\azure-devops-local-mcp`. Do not move this folder afterwards.

3. **Right-click `setup.ps1`** inside the extracted folder and choose **Run with PowerShell**. If Windows asks whether to allow it, click **Run anyway**.

4. **Follow the prompts** — enter your Azure DevOps URL, your Personal Access Token, and optionally a default project name.

5. **Restart Claude Desktop**.

The setup script writes the configuration automatically. You only need to run it once (or again if you get a new token).

---

## Connecting to Claude Code

You connect azure-devops-local-mcp to Claude Code by creating a small configuration file called **`.mcp.json`**. You do this once, and Claude Code will start azure-devops-local-mcp automatically every time you use it.

You will also need a **Personal Access Token (PAT)** from Azure DevOps — this is how azure-devops-local-mcp proves to Azure DevOps that it is allowed to act on your behalf. To create one: click your profile picture in Azure DevOps → **Personal access tokens** → **+ New Token**. Give it a name (e.g. `azure-devops-local-mcp-claude`), set an expiry, and tick only the scopes you need (see the scope column in the Tool Reference section). Copy the token immediately — Azure DevOps only shows it once.

### Where to put the file

Claude Code looks for `.mcp.json` starting from the folder you have open and then walks up through parent folders. This means you can use a single file for all your projects:

| Where you place `.mcp.json` | Who uses it |
|---|---|
| Inside one project folder | Only that project |
| In a shared parent folder (e.g. `C:\Users\YourName\Documents\projects\`) | All projects under that folder |
| In your home folder (`C:\Users\YourName\`) | Every Claude Code session on your PC |

Most people place it one level above all their Azure DevOps projects.

### Create the file

Create a new file called `.mcp.json` in your chosen folder with this content:

```json
{
  "mcpServers": {
    "ado": {
      "command": "azure-devops-local-mcp",
      "env": {
        "ADO_ORG_URL": "https://dev.azure.com/your-org",
        "ADO_PAT": "paste-your-pat-here",
        "ADO_DEFAULT_PROJECT": "MyProject"
      }
    }
  }
}
```

Replace the values:

| Placeholder | What to put there |
|---|---|
| `https://dev.azure.com/your-org` | Your Azure DevOps organisation URL |
| `paste-your-pat-here` | The PAT you copied from Azure DevOps |
| `MyProject` | Optional — a default project name so you don't have to type it every time |

> **Note:** The token is stored as plain text in this file — treat it like a password. Do not share this file or email it to anyone.

### Confirm the connection

Open Claude Code and type:

```
/mcp
```

You should see `ado` listed as a connected server. If it shows an error, see the Troubleshooting section.

---

## Connecting to Claude Chat (Web)

Claude Chat connects to azure-devops-local-mcp over a local web address. You start azure-devops-local-mcp as a local server, then point Claude Chat to it.

### 1. Start the server

Open PowerShell and run the following commands one at a time:

```
$env:ADO_ORG_URL = "https://dev.azure.com/your-org"
$env:ADO_PAT = "your-pat-here"
$env:ADO_DEFAULT_PROJECT = "MyProject"
azure-devops-local-mcp --transport http
```

The server starts and listens on `http://localhost:3100`. **Keep this PowerShell window open** while you use Claude Chat.

To use a different port:

```
$env:PORT = "4000"
azure-devops-local-mcp --transport http
```

### 2. Connect in Claude Chat

1. Open **claude.ai** → **Settings → Integrations** (or the MCP panel in your project)
2. Add a new MCP server with URL: `http://localhost:3100/mcp`
3. Save — Claude Chat will connect and list the available tools

---

## Tool Reference

All tools follow the naming pattern `ado_<area>_<action>`. You never need to call these by name — just describe what you want to Claude.

### Projects

| Tool | What it does |
|---|---|
| `ado_projects_list` | List all projects in the organisation |

### Work Items

| Tool | What it does | PAT scope needed |
|---|---|---|
| `ado_workitems_query` | Run a WIQL query | Work Items — Read |
| `ado_workitems_list_recent` | Recent items, optional type/state/assignee filter | Work Items — Read |
| `ado_workitems_get` | Full details of one item by ID | Work Items — Read |
| `ado_workitems_create` | Create a new work item | Work Items — Read & Write |
| `ado_workitems_update` | Update fields on an existing item | Work Items — Read & Write |
| `ado_workitems_link` | Link two work items (parent/child, related, …) | Work Items — Read & Write |
| `ado_workitems_unlink` | Remove a link between two work items | Work Items — Read & Write |

### Git & Pull Requests

| Tool | What it does | PAT scope needed |
|---|---|---|
| `ado_git_list_repos` | List repositories in a project | Code — Read |
| `ado_git_list_prs` | List pull requests (filter by status, creator) | Code — Read |
| `ado_git_get_pr` | Full details of one PR | Code — Read |
| `ado_git_get_pr_threads` | Comments and review threads on a PR | Code — Read |
| `ado_git_create_pr_comment` | Reply to a thread or add an inline comment | Code — Read & Write |

### Pipelines

| Tool | What it does | PAT scope needed |
|---|---|---|
| `ado_pipelines_list` | List pipeline definitions | Build — Read |
| `ado_pipelines_list_runs` | Recent runs, filter by pipeline or status | Build — Read |
| `ado_pipelines_get_run` | Details of one run | Build — Read |
| `ado_pipelines_trigger` | Queue a new run | Build — Read & Execute |
| `ado_pipelines_get_logs` | Log file list for a build | Build — Read |

### Code Search

| Tool | What it does | PAT scope needed |
|---|---|---|
| `ado_git_search_code` | Full-text search across repositories | Code — Read |

### Wiki

| Tool | What it does | PAT scope needed |
|---|---|---|
| `ado_wiki_list` | List wikis in a project | Wiki — Read |
| `ado_wiki_list_pages` | List pages in a wiki (paginated) | Wiki — Read |
| `ado_wiki_get_page` | Read content of a single page | Wiki — Read |
| `ado_wiki_update_page` | Create or update a wiki page | Wiki — Read & Write |

### Test Plans

| Tool | What it does | PAT scope needed |
|---|---|---|
| `ado_testplans_list` | List test plans in a project | Test Management — Read |
| `ado_testplans_get` | Details of one test plan | Test Management — Read |
| `ado_testplans_create` | Create a new test plan | Test Management — Read & Write |
| `ado_testsuites_list` | List suites under a test plan | Test Management — Read |
| `ado_testsuites_create` | Create a suite within a test plan | Test Management — Read & Write |
| `ado_testcases_list` | List test cases in a suite | Test Management — Read |
| `ado_testcases_add_to_suite` | Add existing test cases to a suite | Test Management — Read & Write |

---

## Example Conversations

The examples below show what you can type to Claude once azure-devops-local-mcp is connected. You never need to mention tool names.

### Work items

```
Show me all open bugs in the Backend project.
```

```
List the 10 most recently updated work items assigned to me.
```

```
Find all User Stories in Sprint 14 that are still Active.
```

```
Create a Bug titled "Login page crashes on Safari" in the Frontend project,
assign it to john.doe@company.com, priority 2.
```

```
Update work item #1042 — change state to Resolved and add the tag "hotfix".
```

### Pull requests

```
List all open PRs in the demo-backend repository.
```

```
Show me PR #87 including the review comments.
```

```
Add a comment to PR #87 thread #3: "Agreed, let's refactor this in a follow-up."
```

```
Which PRs did Alice create last week?
```

### Pipelines

```
What pipelines exist in the Infra project?
```

```
Show me the last 5 runs of the "deploy-production" pipeline.
```

```
Trigger the "build-api" pipeline on branch feature/auth-v2.
```

```
Show me the build logs for run #3201.
```

### Code search

```
Search for "KafkaProducer" across all repositories.
```

```
Find all files containing "TODO: remove" in the demo-backend repo.
```

### Wiki

```
Show me the content of the wiki page /Architecture/Overview.
```

```
Update the wiki page /Runbooks/Deploy with this new content: ...
```

---

## Troubleshooting

### Node.js is not installed or too old

azure-devops-local-mcp requires Node.js version 20 or later. To check which version you have, open PowerShell and run:

```
node --version
```

If it prints `v20.x.x` or higher you are good. If it says the command was not found, or shows a lower version, download the latest LTS version from [https://nodejs.org](https://nodejs.org) and run the installer again.

### "No authentication method configured"

azure-devops-local-mcp could not find your token. Check that `ADO_PAT` is filled in correctly in `.mcp.json` and that there are no extra spaces before or after the token.

### "Authentication failed"

The token was found but rejected by Azure DevOps. Common causes:

- The token has expired — go to Azure DevOps and create a new one
- The token does not have the right scope for what you are trying to do (see the scope column in Tool Reference)
- The `ADO_ORG_URL` points to the wrong organisation

### "Resource not found"

The project or item does not exist, or your token does not have access to it. Check that the project name is spelled correctly.

### Tool returns "An unexpected error occurred"

Try checking that your Azure DevOps organisation URL does not have a trailing slash at the end (e.g. `https://dev.azure.com/myorg` not `https://dev.azure.com/myorg/`).

### Claude Code says the server is not connected

- Open Claude Code and run `/mcp` to see the current status and any error message
- Quit and reopen Claude Code after editing `.mcp.json`

### Claude Chat server does not respond

- Check that the PowerShell window with `azure-devops-local-mcp --transport http` is still open
- Check that nothing else is using port 3100: open PowerShell and run `netstat -ano | findstr :3100`
- Make sure the URL in Claude Chat is `http://localhost:3100/mcp` (with `/mcp` at the end)
