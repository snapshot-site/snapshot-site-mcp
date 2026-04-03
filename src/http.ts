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
} from "./mcpServer.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const BASE_PATH = process.env.MCP_PATH ?? "/";
const HEALTH_PATH = process.env.HEALTH_PATH ?? "/healthz";
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
    const server = createMcpServer((tool) => {
      if (auth.kind === "apiKey") {
        return createApiKeyClient(auth.apiKey);
      }

      const identity = getBearerIdentity(auth.claims);
      return authorizeToolAndReturnClient(identity, tool, (productAccessToken, requestId) =>
        createBearerClient(productAccessToken, process.env.SNAPSHOT_SITE_BASE_URL, requestId)
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
