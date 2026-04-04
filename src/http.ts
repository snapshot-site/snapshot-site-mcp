#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  authenticateRequest,
  getBearerIdentity,
  getProtectedResourceMetadata,
  sendUnauthorized,
} from "./auth.js";
import { authorizeToolAndReturnClient } from "./adminAuth.js";
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  createBearerClient,
  createApiKeyClient,
  createMcpServer,
  type ForwardedNetworkHeaders,
} from "./mcpServer.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const BASE_PATH = process.env.MCP_PATH ?? "/mcp";
const HEALTH_PATH = process.env.HEALTH_PATH ?? "/healthz";
const OIDC_ISSUER = String(process.env.OIDC_ISSUER_URL || "").trim().replace(/\/+$/, "");
const OIDC_DISCOVERY_CLIENT_ID = String(process.env.OIDC_DISCOVERY_CLIENT_ID || "").trim() || String(process.env.OIDC_AUDIENCE || "").trim();
const RESOURCE_NAME = String(process.env.RESOURCE_NAME || "Snapshot Site MCP").trim();
const ALLOWED_HOSTS = new Set(
  (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, statusCode: number, body: string) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
}

function getHeaderValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && value[0]?.trim()) {
    return value[0].trim();
  }
  return undefined;
}

function validateHost(req: IncomingMessage): boolean {
  if (ALLOWED_HOSTS.size === 0) {
    return true;
  }

  const hostHeader = req.headers.host;
  if (!hostHeader) {
    return false;
  }

  const hostname = hostHeader.split(":")[0]?.trim().toLowerCase();
  return Boolean(hostname) && ALLOWED_HOSTS.has(hostname);
}

function logIncomingRequest(req: IncomingMessage) {
  const authorization = getHeaderValue(req, "authorization");
  const apiKey = getHeaderValue(req, "x-snapshotsiteapi-key");
  const userAgent = getHeaderValue(req, "user-agent");
  const forwardedFor = getHeaderValue(req, "x-forwarded-for");

  process.stdout.write(
    `[snapshot-site-mcp] incoming request method=${req.method || "-"} url=${req.url || "-"} has_authorization=${authorization ? "true" : "false"} has_api_key=${apiKey ? "true" : "false"} user_agent=${JSON.stringify(userAgent || "")} x_forwarded_for=${JSON.stringify(forwardedFor || "")}\n`
  );
}

function getForwardedNetworkHeaders(req: IncomingMessage): ForwardedNetworkHeaders {
  return {
    xForwardedFor: getHeaderValue(req, "x-forwarded-for"),
    xRealIp: getHeaderValue(req, "x-real-ip"),
    trueClientIp: getHeaderValue(req, "true-client-ip"),
    cfConnectingIp: getHeaderValue(req, "cf-connecting-ip"),
  };
}

function getExternalBaseUrl(req: IncomingMessage): string {
  if (process.env.RESOURCE_SERVER_URL) {
    return String(process.env.RESOURCE_SERVER_URL).trim().replace(/\/+$/, "");
  }

  const host = req.headers.host ?? "localhost";
  const protocol = req.headers["x-forwarded-proto"] ?? "https";
  const value = Array.isArray(protocol) ? protocol[0] : protocol;
  return `${value}://${host}`;
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function copyResponseHeaders(upstream: Response, res: ServerResponse) {
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") {
      return;
    }
    res.setHeader(key, value);
  });
}

function rewriteOidcConfiguration(payload: Record<string, unknown>, externalBaseUrl: string) {
  const rewritten = { ...payload };
  const replacements = [
    "authorization_endpoint",
    "token_endpoint",
    "device_authorization_endpoint",
    "revocation_endpoint",
    "introspection_endpoint",
    "registration_endpoint",
    "end_session_endpoint",
    "jwks_uri",
  ] as const;

  for (const field of replacements) {
    const value = payload[field];
    if (typeof value === "string" && OIDC_ISSUER && value.startsWith(OIDC_ISSUER)) {
      rewritten[field] = `${externalBaseUrl}${value.slice(OIDC_ISSUER.length)}`;
    }
  }

  rewritten.registration_endpoint = `${externalBaseUrl}/oauth/register`;

  return rewritten;
}

function getRegistrationResponse(externalBaseUrl: string) {
  return {
    client_id: OIDC_DISCOVERY_CLIENT_ID,
    client_name: RESOURCE_NAME,
    redirect_uris: [
      "https://claude.ai/api/mcp/auth_callback",
      "https://chatgpt.com/connector/oauth/w0oabBZKFoKC",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    client_uri: externalBaseUrl,
  };
}

async function proxyOidcRequest(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!OIDC_ISSUER) {
    sendText(res, 404, "Not found");
    return;
  }

  const upstreamUrl = `${OIDC_ISSUER}${url.pathname}${url.search}`;
  const headers = new Headers();
  const contentType = getHeaderValue(req, "content-type");
  const accept = getHeaderValue(req, "accept");
  const userAgent = getHeaderValue(req, "user-agent");
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);
  if (userAgent) headers.set("user-agent", userAgent);

  const bodyBuffer = req.method && req.method !== "GET" && req.method !== "HEAD" ? await readRawBody(req) : undefined;
  const body = bodyBuffer && bodyBuffer.byteLength > 0 ? new Uint8Array(bodyBuffer) : undefined;
  const upstream = await fetch(upstreamUrl, {
    method: req.method || "GET",
    headers,
    body,
    redirect: "manual",
  });

  res.statusCode = upstream.status;
  copyResponseHeaders(upstream, res);

  const location = upstream.headers.get("location");
  if (location && OIDC_ISSUER && location.startsWith(OIDC_ISSUER)) {
    res.setHeader("location", `${getExternalBaseUrl(req)}${location.slice(OIDC_ISSUER.length)}`);
  }

  if (url.pathname === "/.well-known/openid-configuration" && upstream.ok) {
    const payload = (await upstream.json()) as Record<string, unknown>;
    sendJson(res, upstream.status, rewriteOidcConfiguration(payload, getExternalBaseUrl(req)));
    return;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (!res.hasHeader("content-length")) {
    res.setHeader("content-length", String(buffer.byteLength));
  }
  res.end(buffer);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") {
    return undefined;
  }

  return JSON.parse(raw) as unknown;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  logIncomingRequest(req);

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendText(res, 405, "Method not allowed");
    return;
  }

  let body: unknown;

  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Invalid JSON body",
      },
      id: null,
    });
    return;
  }

  try {
    const auth = await authenticateRequest(req);
    const forwardedHeaders = getForwardedNetworkHeaders(req);
    const server = createMcpServer((tool) => {
      if (auth.kind === "apiKey") {
        return createApiKeyClient(auth.apiKey, process.env.SNAPSHOT_SITE_BASE_URL, forwardedHeaders);
      }

      const identity = getBearerIdentity(auth.claims);
      return authorizeToolAndReturnClient(identity, tool, (productAccessToken, requestId) =>
        createBearerClient(productAccessToken, process.env.SNAPSHOT_SITE_BASE_URL, requestId, forwardedHeaders)
      );
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    await server.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal MCP server error";
    process.stderr.write(`[snapshot-site-mcp] request failed: ${message}\n`);

    if (error instanceof Error && /Missing bearer token|Missing required scope|OIDC issuer|JWT|token|signature|claim|issuer|audience/i.test(error.message)) {
      sendUnauthorized(req, res, error.message, ['error="invalid_token"']);
      return;
    }

    if (error instanceof Error && /Authorization denied:/i.test(error.message)) {
      sendJson(res, 403, {
        jsonrpc: "2.0",
        error: {
          code: -32003,
          message,
        },
        id: null,
      });
      return;
    }

    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message,
        },
        id: null,
      });
    }
  }
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const protectedResourceMetadata = getProtectedResourceMetadata();

  if (req.method === "GET" && url.pathname === HEALTH_PATH) {
    sendJson(res, 200, {
      status: "ok",
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      mode: "http-stateless",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource" && protectedResourceMetadata) {
    sendJson(res, 200, protectedResourceMetadata);
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && url.pathname === "/oauth/register") {
    if (!OIDC_DISCOVERY_CLIENT_ID) {
      sendJson(res, 501, {
        error: "registration_not_supported",
        error_description: "OIDC_DISCOVERY_CLIENT_ID is not configured",
      });
      return;
    }

    sendJson(res, 200, getRegistrationResponse(getExternalBaseUrl(req)));
    return;
  }

  if (
    url.pathname === "/.well-known/openid-configuration" ||
    url.pathname.startsWith("/oauth/v2/")
  ) {
    await proxyOidcRequest(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/" && BASE_PATH !== "/") {
    res.statusCode = 302;
    res.setHeader("location", BASE_PATH);
    res.end();
    return;
  }

  if (!validateHost(req)) {
    sendText(res, 403, "Forbidden host");
    return;
  }

  if (url.pathname !== BASE_PATH) {
    sendText(res, 404, "Not found");
    return;
  }

  await handleMcpRequest(req, res);
});

httpServer.listen(PORT, HOST, () => {
  process.stdout.write(`Snapshot Site MCP HTTP server listening on ${HOST}:${PORT}${BASE_PATH}\n`);
});

async function shutdown(signal: string) {
  process.stdout.write(`Received ${signal}, shutting down MCP HTTP server\n`);
  httpServer.close((error) => {
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
