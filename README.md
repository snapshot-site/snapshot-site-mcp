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

## Local stdio mode

```bash
export SNAPSHOT_SITE_API_KEY=ss_live_xxx
snapshot-site-mcp
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

## Remote HTTP mode

This package also supports a hosted MCP endpoint for clients using `mcp-remote`.

Start the HTTP server:

```bash
pnpm start:http
```

or:

```bash
npx snapshot-site-mcp-http
```

Environment variables:

```bash
export PORT=3000
export HOST=0.0.0.0
export MCP_PATH=/
export HEALTH_PATH=/healthz
export MCP_ALLOWED_HOSTS=mcp.snapshot-site.com
export SNAPSHOT_SITE_BASE_URL=https://api.prod.ss.snapshot-site.com
```

Remote client configuration with direct API key header:

```json
{
  "mcpServers": {
    "Snapshot Site MCP": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.snapshot-site.com",
        "--header",
        "x-snapshotsiteapi-key: ss_live_xxx"
      ]
    }
  }
}
```

The hosted server is stateless. Each request authenticates with `x-snapshotsiteapi-key`, which makes the service safe to run on multiple replicas without session affinity.

## Zitadel / OAuth

The remote HTTP server also supports OAuth bearer tokens validated against an OIDC issuer such as Zitadel.

Environment variables:

```bash
export OIDC_ISSUER_URL=https://auth.snapshot-site.com
export OIDC_AUDIENCE=snapshot-site-mcp
export OIDC_REQUIRED_SCOPE=claudeai
export RESOURCE_SERVER_URL=https://mcp.snapshot-site.com
export ALLOW_API_KEY_AUTH=false
export SNAPSHOT_SITE_API_KEY=ss_server_side_xxx
```

In bearer-token mode, the MCP server validates the incoming access token against the issuer JWKS and then uses the server-side Snapshot Site API key to call the backend API.

It also exposes:

```text
GET /.well-known/oauth-protected-resource
```

so MCP clients can discover the authorization server metadata automatically.
