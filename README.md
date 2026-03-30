# Snapshot Site MCP

[![npm](https://img.shields.io/npm/v/%40snapshot-site%2Fmcp.svg)](https://www.npmjs.com/package/@snapshot-site/mcp)
[![Node](https://img.shields.io/badge/node-%3E%3D20.9.0-339933.svg)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/snapshot-site/snapshot-site-mcp.svg?cacheSeconds=300)](https://github.com/snapshot-site/snapshot-site-mcp/blob/main/LICENSE)
[![CI](https://github.com/snapshot-site/snapshot-site-mcp/actions/workflows/tests.yml/badge.svg)](https://github.com/snapshot-site/snapshot-site-mcp/actions/workflows/tests.yml)

Official MCP server for the Snapshot Site API

Create your API token in Snapshot Site Console:

- https://console.snapshot-site.com

## Tools

- `screenshot`
- `analyze`
- `compare`

These tools are annotated for MCP clients as:

- read-only
- idempotent
- open-world

They also include richer titles, category metadata, and example intents to improve tool selection in Claude Desktop and Cursor.

## Environment

```bash
export SNAPSHOT_SITE_API_KEY=ss_live_xxx
export SNAPSHOT_SITE_BASE_URL=https://api.prod.ss.snapshot-site.com
```

## Build

```bash
pnpm install
pnpm run build
```

## Claude Desktop configuration

```json
{
  "mcpServers": {
    "snapshot-site": {
      "command": "node",
      "args": ["/absolute/path/to/snapshot-site-mcp/build/server.js"],
      "env": {
        "SNAPSHOT_SITE_API_KEY": "ss_live_xxx",
        "SNAPSHOT_SITE_BASE_URL": "https://api.prod.ss.snapshot-site.com"
      }
    }
  }
}
```

## Cursor configuration

```json
{
  "mcpServers": {
    "snapshot-site": {
      "command": "node",
      "args": ["/absolute/path/to/snapshot-site-mcp/build/server.js"],
      "env": {
        "SNAPSHOT_SITE_API_KEY": "ss_live_xxx"
      }
    }
  }
}
```
