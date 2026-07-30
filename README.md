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

## Business rules

### Two usage modes

- Simple local mode:
  - the client provides `SNAPSHOT_SITE_API_KEY`
  - the MCP server calls the Snapshot Site API directly
- Remote OAuth mode:
  - the client authenticates through Zitadel/OIDC
  - the MCP server then asks `admin-snapshot` for authorization to use the tool on behalf of the end user
  - `admin-snapshot` returns a `productAccessToken`

### Server-side technical key

- In remote OAuth mode, the MCP server also uses a server-side `SNAPSHOT_SITE_API_KEY`.
- This technical key does not represent the end user.
- Its purpose is to:
  - go through the standard logging/usage pipeline on the `screenshot-api` side
  - attach technical counters and `ApiRequestLog`
- Plan and business quotas are still evaluated against the end user carried by the bearer token and then by the `productAccessToken`.

### Candidate endpoints

- The MCP server declares its `candidateEndpoints` to `admin-snapshot` before execution.
- `screenshot` currently advertises `["/api/v1/screenshot", "/api/v2/screenshot"]`.
- `analyze` advertises `["/api/v3/analyze"]`.
- `compare` advertises `["/api/v3/compare"]`.
- The actual execution of `screenshot` goes through the official SDK, and therefore hits `/api/v2/screenshot`.

### Quotas

- The MCP server must not bypass business quotas.
- When `screenshot-api` is configured correctly, MCP calls count against the same global user quota as direct API calls.
- `hard` plans must be blocked at the limit.
- `soft` plans with overage allowed must keep going through.

### Logging and IP

- In remote OAuth mode, the MCP server must forward:
  - `Authorization: Bearer <productAccessToken>` to `screenshot-api`
  - `x-snapshotsiteapi-key: <SNAPSHOT_SITE_API_KEY>`
  - `x-request-id`
  - the relevant network headers (`x-forwarded-for`, `x-real-ip`, `true-client-ip`, `cf-connecting-ip`) when present
- Otherwise hosted MCP requests see the pod/proxy IP instead of the user IP.

## Claude / OAuth / MCP flow

```text
1. Discovery

Claude
  -> GET https://mcp.snapshot-site.com/.well-known/oauth-protected-resource

MCP
  -> responds:
     authorization_servers = https://mcp.snapshot-site.com
```

```text
2. OAuth

Claude
  -> must know client_id
  -> opens Zitadel:
     https://mcp.snapshot-site.com/oauth/v2/authorize
     ?client_id=...
     &redirect_uri=https://claude.ai/api/mcp/auth_callback
     &response_type=code
     &code_challenge=...
```

```text
3. Token

Zitadel
  -> returns an access token to Claude

Claude
  -> calls the MCP server:
     POST https://mcp.snapshot-site.com/
     Authorization: Bearer <access_token>
```

```text
4. Validation on the MCP side

snapshot-site-mcp
  -> introspects/validates the token against Zitadel
  -> extracts the user identity:
     sub
     email
```

```text
5. Product authorization

snapshot-site-mcp
  -> POST admin-snapshot /api/internal/mcp/authorize
     Authorization: Bearer <internal_service_jwt>
     body:
       zitadelSub
       email
       tool
       candidateEndpoints
       requestId

admin-snapshot
  -> checks:
     user
     subscription
     plan
     allowed endpoints
  -> signs a productAccessToken
```

```text
6. Product API call

snapshot-site-mcp
  -> POST screenshot-api /api/v2/screenshot
     Authorization: Bearer <productAccessToken>
     x-snapshotsiteapi-key: <SNAPSHOT_SITE_API_KEY>
```

```text
7. Final check on the screenshot-api side

screenshot-api
  -> validates the productAccessToken
  -> resolves the real user
  -> applies:
     endpoint allowed
     global user quota
     hard vs soft overage
  -> logs:
     McpExecutionLog
     ApiRequestLog
     UsageCounter
```

### Verifying the deployment

```bash
curl -s https://mcp.snapshot-site.com/.well-known/oauth-protected-resource | jq
curl -s https://mcp.snapshot-site.com/.well-known/openid-configuration | jq
curl -i https://mcp.snapshot-site.com/
curl -i -X POST https://mcp.snapshot-site.com/mcp -H 'content-type: application/json' --data '{}'
```

### Manual vs implicit client_id

- The `client_id` is only needed for the `Claude -> Zitadel /oauth/v2/authorize` step.
- If Claude cannot discover that `client_id` before this call, it has to be entered manually in the connector UI.
- The MCP server cannot inject it later once the OAuth flow has started.
- The MCP server can publish an experimental implicit mode by exposing a `preferred_client_id` in `/.well-known/oauth-protected-resource`.
- Clients that know how to read this metadata may then be able to skip the manual entry.
- Clients that ignore this field will still require a manual `client_id`.

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
export MCP_PATH=/mcp
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
        "https://mcp.snapshot-site.com/mcp",
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
export OIDC_DISCOVERY_CLIENT_ID=366546620977775166
export RESOURCE_SERVER_URL=https://mcp.snapshot-site.com
export ALLOW_API_KEY_AUTH=false
export SNAPSHOT_SITE_API_KEY=ss_server_side_xxx
```

In bearer-token mode, the MCP server validates the incoming access token against the issuer JWKS and then uses the server-side Snapshot Site API key to call the backend API.

It also exposes and proxies:

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/openid-configuration
GET/POST /oauth/v2/*
GET /ui/*
GET/POST /oauth/register
```

so MCP clients can discover the authorization server metadata automatically.

When `OIDC_DISCOVERY_CLIENT_ID` is set, the protected resource metadata also includes:

```json
{
  "resource_name": "Snapshot Site MCP",
  "preferred_client_id": "366546620977775166",
  "oauth_client_metadata": {
    "client_id": "366546620977775166",
    "token_endpoint_auth_method": "none"
  }
}
```

This is an experimental compatibility hint for clients that can infer the OAuth public client automatically. Manual `client_id` entry remains the reliable fallback.

The MCP server also exposes a lightweight `registration_endpoint` compatibility shim at:

```text
POST https://mcp.snapshot-site.com/oauth/register
```

This shim currently returns the preconfigured public PKCE client instead of provisioning a brand-new Zitadel client per installation. It validates and reflects the `redirect_uris` requested by the client, as long as they are valid HTTPS URLs. It is meant to improve compatibility with clients that expect DCR-style discovery, while keeping the existing manual flow as fallback.
