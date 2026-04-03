import { SignJWT, decodeJwt } from "jose";

const INTERNAL_SERVICE_JWT_SECRET = String(process.env.INTERNAL_SERVICE_JWT_SECRET || "").trim();
const INTERNAL_SERVICE_AUDIENCE = String(process.env.INTERNAL_SERVICE_AUDIENCE || "admin-snapshot-internal").trim();
const MCP_INTERNAL_ISSUER = String(process.env.MCP_INTERNAL_ISSUER || "snapshot-site-mcp").trim();
const ADMIN_SNAPSHOT_INTERNAL_AUTH_URL = String(
  process.env.ADMIN_SNAPSHOT_INTERNAL_AUTH_URL || "",
).trim();

export type SupportedTool = "screenshot" | "analyze" | "compare";

type AuthorizationResponse = {
  authorized: boolean;
  reason?: string;
  requestId?: string;
  userId?: string;
  email?: string;
  zitadelSub?: string | null;
  tool?: string | null;
  subscriptionStatus?: string;
  planCode?: string;
  allowedEndpoints?: string[];
  permittedCandidateEndpoints?: string[];
  productAccessToken?: string;
};

type Identity = {
  sub: string | null;
  email: string | null;
};

const TOOL_CANDIDATE_ENDPOINTS: Record<SupportedTool, string[]> = {
  screenshot: ["/api/v1/screenshot", "/api/v2/screenshot"],
  analyze: ["/api/v3/analyze"],
  compare: ["/api/v3/compare"],
};

function getJwtSecret(): Uint8Array {
  if (!INTERNAL_SERVICE_JWT_SECRET) {
    throw new Error("INTERNAL_SERVICE_JWT_SECRET is not configured");
  }

  return new TextEncoder().encode(INTERNAL_SERVICE_JWT_SECRET);
}

function getRequestId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function signInternalServiceJwt(subject: string, expiresInSeconds = 300): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(MCP_INTERNAL_ISSUER)
    .setAudience(INTERNAL_SERVICE_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getJwtSecret());
}

export async function authorizeTool(identity: Identity, tool: SupportedTool): Promise<AuthorizationResponse> {
  if (!ADMIN_SNAPSHOT_INTERNAL_AUTH_URL) {
    throw new Error("ADMIN_SNAPSHOT_INTERNAL_AUTH_URL is not configured");
  }

  if (!identity.sub) {
    throw new Error("Missing bearer token subject");
  }

  const requestId = getRequestId();
  const serviceToken = await signInternalServiceJwt("snapshot-site-mcp");
  const response = await fetch(ADMIN_SNAPSHOT_INTERNAL_AUTH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
      "x-request-id": requestId,
    },
    body: JSON.stringify({
      zitadelSub: identity.sub,
      email: identity.email,
      tool,
      candidateEndpoints: TOOL_CANDIDATE_ENDPOINTS[tool],
      requestId,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as AuthorizationResponse & {
    message?: string;
  };

  if (!response.ok && response.status !== 403) {
    throw new Error(payload.message || `Admin authorization failed with status ${response.status}`);
  }

  if (!payload.authorized) {
    const reason = payload.reason || payload.message || "authorization_denied";
    throw new Error(`Authorization denied: ${reason}`);
  }

  return {
    ...payload,
    requestId,
  };
}

export async function authorizeToolAndReturnClient<T>(
  identity: Identity,
  tool: SupportedTool,
  createClient: (productAccessToken: string, requestId?: string) => T,
): Promise<T> {
  const authorization = await authorizeTool(identity, tool);
  if (!authorization.productAccessToken) {
    throw new Error("Missing product access token from admin authorization");
  }

  try {
    decodeJwt(authorization.productAccessToken);
  } catch {
    throw new Error("Invalid product access token received from admin authorization");
  }

  return createClient(authorization.productAccessToken, authorization.requestId);
}
