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

## Règles métier

### Deux modes d'usage

- Mode local simple :
  - le client fournit `SNAPSHOT_SITE_API_KEY`
  - le MCP appelle directement l'API Snapshot Site
- Mode remote OAuth :
  - le client s'authentifie via Zitadel/OIDC
  - le MCP demande ensuite à `admin-snapshot` l'autorisation d'utiliser l'outil pour l'utilisateur final
  - `admin-snapshot` renvoie un `productAccessToken`

### Clé technique serveur

- En mode remote OAuth, le MCP utilise aussi une API key serveur `SNAPSHOT_SITE_API_KEY`.
- Cette clé technique ne représente pas l'utilisateur final.
- Elle sert à :
  - passer dans le pipeline standard de logs/usage côté `screenshot-api`
  - rattacher les compteurs techniques et `ApiRequestLog`
- Le plan et les quotas métier restent évalués sur l'utilisateur final porté par le bearer token puis par le `productAccessToken`.

### Candidate endpoints

- Le MCP déclare ses `candidateEndpoints` à `admin-snapshot` avant exécution.
- `screenshot` annonce aujourd'hui `["/api/v1/screenshot", "/api/v2/screenshot"]`.
- `analyze` annonce `["/api/v3/analyze"]`.
- `compare` annonce `["/api/v3/compare"]`.
- L'exécution réelle de `screenshot` passe par le SDK officiel, donc vers `/api/v2/screenshot`.

### Quotas

- Le MCP ne doit pas contourner les quotas métier.
- Quand `screenshot-api` est correctement configurée, les appels MCP comptent dans le même quota global utilisateur que les appels API directs.
- Les plans `hard` doivent être bloqués à la limite.
- Les plans `soft` avec overage autorisé doivent continuer à passer.

### Logging et IP

- En mode remote OAuth, le MCP doit forwarder :
  - `Authorization: Bearer <productAccessToken>` vers `screenshot-api`
  - `x-snapshotsiteapi-key: <SNAPSHOT_SITE_API_KEY>`
  - `x-request-id`
  - les headers réseau utiles (`x-forwarded-for`, `x-real-ip`, `true-client-ip`, `cf-connecting-ip`) quand ils existent
- Les requêtes MCP hébergées voient sinon l'IP du pod/proxy au lieu de l'IP utilisateur.

## Schéma Claude / OAuth / MCP

```text
1. Découverte

Claude
  -> GET https://mcp.snapshot-site.com/.well-known/oauth-protected-resource

MCP
  -> répond:
     authorization_servers = https://mcp.snapshot-site.com
```

```text
2. OAuth

Claude
  -> doit connaître client_id
  -> ouvre Zitadel:
     https://mcp.snapshot-site.com/oauth/v2/authorize
     ?client_id=...
     &redirect_uri=https://claude.ai/api/mcp/auth_callback
     &response_type=code
     &code_challenge=...
```

```text
3. Token

Zitadel
  -> renvoie un access token à Claude

Claude
  -> appelle le MCP:
     POST https://mcp.snapshot-site.com/
     Authorization: Bearer <access_token>
```

```text
4. Validation côté MCP

snapshot-site-mcp
  -> introspecte/valide le token auprès de Zitadel
  -> extrait l'identité user:
     sub
     email
```

```text
5. Autorisation produit

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
  -> vérifie:
     user
     subscription
     plan
     allowed endpoints
  -> signe un productAccessToken
```

```text
6. Appel API produit

snapshot-site-mcp
  -> POST screenshot-api /api/v2/screenshot
     Authorization: Bearer <productAccessToken>
     x-snapshotsiteapi-key: <SNAPSHOT_SITE_API_KEY>
```

```text
7. Contrôle final côté screenshot-api

screenshot-api
  -> valide le productAccessToken
  -> résout l'user réel
  -> applique:
     endpoint allowed
     quota global user
     hard vs soft overage
  -> loggue:
     McpExecutionLog
     ApiRequestLog
     UsageCounter
```


```
curl -s https://mcp.snapshot-site.com/.well-known/oauth-protected-resource | jq
curl -s https://mcp.snapshot-site.com/.well-known/openid-configuration | jq
curl -i https://mcp.snapshot-site.com/
curl -i -X POST https://mcp.snapshot-site.com/mcp -H 'content-type: application/json' --data '{}'

```

### Manuel vs implicite

- Le `client_id` n'est nécessaire que pour l'étape `Claude -> Zitadel /oauth/v2/authorize`.
- Si Claude ne peut pas découvrir ce `client_id` avant cet appel, il doit être saisi manuellement dans l'UI du connecteur.
- Le MCP ne peut pas l'injecter plus tard une fois le flow OAuth commencé.
- Le serveur MCP peut publier un mode implicite expérimental en exposant un `preferred_client_id` dans `/.well-known/oauth-protected-resource`.
- Les clients qui savent lire cette metadata pourront éventuellement éviter la saisie manuelle.
- Les clients qui ignorent ce champ continueront à nécessiter un `client_id` manuel.

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

This shim currently returns the preconfigured public PKCE client instead of provisioning a brand-new Zitadel client per installation. It is meant to improve compatibility with clients that expect DCR-style discovery, while keeping the existing manual flow as fallback.
