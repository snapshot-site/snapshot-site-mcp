import type { IncomingMessage, ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

type AuthResult =
  | { kind: "apiKey"; apiKey: string }
  | { kind: "bearer"; claims: JWTPayload };

const OIDC_ISSUER = String(process.env.OIDC_ISSUER_URL || "").trim().replace(/\/+$/, "");
const OIDC_AUDIENCE = String(process.env.OIDC_AUDIENCE || "").trim();
const OIDC_REQUIRED_SCOPE = String(process.env.OIDC_REQUIRED_SCOPE || "").trim();
const OIDC_INTROSPECTION_URL = String(process.env.OIDC_INTROSPECTION_URL || "").trim();
const OIDC_INTROSPECTION_CLIENT_ID = String(process.env.OIDC_INTROSPECTION_CLIENT_ID || "").trim();
const OIDC_INTROSPECTION_CLIENT_SECRET = String(process.env.OIDC_INTROSPECTION_CLIENT_SECRET || "").trim();
const ALLOW_API_KEY_AUTH = String(process.env.ALLOW_API_KEY_AUTH || "true").trim().toLowerCase() !== "false";
const RESOURCE_DOCUMENTATION_URL = String(process.env.RESOURCE_DOCUMENTATION_URL || "https://snapshot-site.com/api-docs").trim();
const RESOURCE_SERVER_URL = String(process.env.RESOURCE_SERVER_URL || "").trim().replace(/\/+$/, "");
const RESOURCE_NAME = String(process.env.RESOURCE_NAME || "Snapshot Site MCP").trim();
const REALM = String(process.env.AUTH_REALM || "snapshot-site-mcp").trim();
const OIDC_DISCOVERY_CLIENT_ID = String(process.env.OIDC_DISCOVERY_CLIENT_ID || "").trim() || OIDC_AUDIENCE;
const OIDC_SCOPES_SUPPORTED_RAW = String(process.env.OIDC_SCOPES_SUPPORTED || "").trim();
const OIDC_SCOPES_SUPPORTED: string[] | null = OIDC_SCOPES_SUPPORTED_RAW
  ? OIDC_SCOPES_SUPPORTED_RAW.split(/[\s,]+/).filter(Boolean)
  : null;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

type IntrospectionResponse = {
  active?: boolean;
  scope?: string;
  sub?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  aud?: string | string[];
  iss?: string;
  [key: string]: unknown;
};

function getBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim() || null;
}

function getApiKey(req: IncomingMessage): string | null {
  const header = req.headers["x-snapshotsiteapi-key"];
  if (typeof header === "string" && header.trim() !== "") {
    return header.trim();
  }

  if (Array.isArray(header) && header[0]?.trim()) {
    return header[0].trim();
  }

  return null;
}

function maskToken(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 12) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}***${value.slice(-6)}`;
}

const DEBUG = String(process.env.DEBUG || "").trim().toLowerCase() === "true";

function logBearerTokenShape(token: string) {
  if (!DEBUG) return;
  const segments = token.split(".").length;
  process.stderr.write(
    `[snapshot-site-mcp] bearer token shape: length=${token.length} segments=${segments} masked=${maskToken(token)}\n`
  );
}

function getResourceMetadataUrl(req: IncomingMessage): string {
  if (RESOURCE_SERVER_URL) {
    return `${RESOURCE_SERVER_URL}/.well-known/oauth-protected-resource`;
  }

  const host = req.headers.host ?? "localhost";
  const protocol = req.headers["x-forwarded-proto"] ?? "https";
  const value = Array.isArray(protocol) ? protocol[0] : protocol;
  return `${value}://${host}/.well-known/oauth-protected-resource`;
}

function getAuthorizationServerUrl(): string {
  return RESOURCE_SERVER_URL || OIDC_ISSUER;
}

function buildWwwAuthenticateHeader(req: IncomingMessage, extras?: string[]): string {
  const parts = [`Bearer realm="${REALM}"`];

  if (OIDC_ISSUER) {
    parts.push(`resource_metadata="${getResourceMetadataUrl(req)}"`);
  }

  if (extras) {
    parts.push(...extras);
  }

  return parts.join(", ");
}

export function sendUnauthorized(
  req: IncomingMessage,
  res: ServerResponse,
  message: string,
  extras?: string[],
) {
  res.statusCode = 401;
  res.setHeader("content-type", "application/json");
  res.setHeader("www-authenticate", buildWwwAuthenticateHeader(req, extras));
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message,
      },
      id: null,
    }),
  );
}

export function getProtectedResourceMetadata() {
  if (!OIDC_ISSUER) {
    return null;
  }

  const scopesSupported = OIDC_SCOPES_SUPPORTED ?? (OIDC_REQUIRED_SCOPE ? [OIDC_REQUIRED_SCOPE] : undefined);

  return {
    resource: RESOURCE_SERVER_URL || undefined,
    resource_name: RESOURCE_NAME || undefined,
    authorization_servers: [getAuthorizationServerUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: scopesSupported,
    resource_documentation: RESOURCE_DOCUMENTATION_URL || undefined,
    preferred_client_id: OIDC_DISCOVERY_CLIENT_ID || undefined,
    oauth_client_metadata: OIDC_DISCOVERY_CLIENT_ID
      ? {
          client_id: OIDC_DISCOVERY_CLIENT_ID,
          token_endpoint_auth_method: "none",
        }
      : undefined,
  };
}

async function verifyBearerToken(token: string): Promise<JWTPayload> {
  if (!OIDC_ISSUER) {
    throw new Error("OIDC issuer is not configured");
  }

  logBearerTokenShape(token);

  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/oauth/v2/keys`));
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: OIDC_ISSUER,
      audience: OIDC_AUDIENCE || undefined,
    });

    if (OIDC_REQUIRED_SCOPE) {
      const scopeValue = typeof payload.scope === "string" ? payload.scope : "";
      const scopes = new Set(scopeValue.split(/\s+/).filter(Boolean));
      if (!scopes.has(OIDC_REQUIRED_SCOPE)) {
        throw new Error(`Missing required scope: ${OIDC_REQUIRED_SCOPE}`);
      }
    }

    return payload;
  } catch (error) {
    if (!(error instanceof Error) || !/Invalid Compact JWS|Invalid JWT|JOSE|JWS/i.test(error.message)) {
      throw error;
    }

    return introspectBearerToken(token);
  }
}

async function introspectBearerToken(token: string): Promise<JWTPayload> {
  if (!OIDC_INTROSPECTION_URL) {
    throw new Error("Opaque access token received but OIDC introspection is not configured");
  }

  if (!OIDC_INTROSPECTION_CLIENT_ID || !OIDC_INTROSPECTION_CLIENT_SECRET) {
    throw new Error("OIDC introspection client credentials are not configured");
  }

  const body = new URLSearchParams();
  body.set("token", token);
  body.set("token_type_hint", "access_token");
  body.set("scope", "openid");

  const response = await fetch(OIDC_INTROSPECTION_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${OIDC_INTROSPECTION_CLIENT_ID}:${OIDC_INTROSPECTION_CLIENT_SECRET}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    process.stderr.write(
      `[snapshot-site-mcp] introspection error: status=${response.status} body=${errorBody}\n`
    );
    throw new Error(`OIDC introspection failed with status ${response.status}`);
  }

  const payload = (await response.json()) as IntrospectionResponse;
  if (DEBUG) {
    process.stderr.write(
      `[snapshot-site-mcp] introspection result: ${JSON.stringify({
        active: payload.active ?? null,
        iss: payload.iss ?? null,
        sub: payload.sub ?? null,
        aud: payload.aud ?? null,
        scope: payload.scope ?? null,
        client_id: payload.client_id ?? null,
        username: payload.username ?? null,
        token_type: payload.token_type ?? null,
        exp: payload.exp ?? null,
      })}\n`
    );
  }
  if (!payload.active) {
    throw new Error("Inactive access token");
  }

  if (payload.iss && payload.iss !== OIDC_ISSUER) {
    throw new Error("Invalid token issuer");
  }

  if (OIDC_AUDIENCE) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!audiences.includes(OIDC_AUDIENCE)) {
      throw new Error("Invalid token audience");
    }
  }

  if (OIDC_REQUIRED_SCOPE) {
    const scopeValue = typeof payload.scope === "string" ? payload.scope : "";
    const scopes = new Set(scopeValue.split(/\s+/).filter(Boolean));
    if (!scopes.has(OIDC_REQUIRED_SCOPE)) {
      throw new Error(`Missing required scope: ${OIDC_REQUIRED_SCOPE}`);
    }
  }

  return payload as JWTPayload;
}

export async function authenticateRequest(req: IncomingMessage): Promise<AuthResult> {
  const bearerToken = getBearerToken(req);
  if (bearerToken) {
    const claims = await verifyBearerToken(bearerToken);
    return { kind: "bearer", claims };
  }

  if (ALLOW_API_KEY_AUTH) {
    const apiKey = getApiKey(req);
    if (apiKey) {
      return { kind: "apiKey", apiKey };
    }
  }

  throw new Error("Missing bearer token or x-snapshotsiteapi-key header");
}

function getStringClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getBearerIdentity(claims: JWTPayload): {
  sub: string | null;
  email: string | null;
} {
  const sub = getStringClaim(claims.sub);
  const email =
    getStringClaim(claims.email) ||
    getStringClaim(claims.preferred_username) ||
    getStringClaim(claims.username);

  return {
    sub,
    email: email?.toLowerCase() ?? null,
  };
}
