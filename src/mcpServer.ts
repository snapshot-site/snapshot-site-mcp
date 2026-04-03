import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  SnapshotSiteClient,
  type AnalyzeRequest,
  type ScreenshotRequest,
  type VisualDiffRequest,
} from "@snapshot-site/sdk";
import type { SupportedTool } from "./adminAuth.js";

export const MCP_SERVER_NAME = "snapshot-site";
export const MCP_SERVER_VERSION = "0.1.1";
export const MCP_USER_AGENT = "@snapshot-site/mcp/0.1.1";

export type SnapshotSiteClientFactory = (tool: SupportedTool) => Promise<SnapshotSiteClient> | SnapshotSiteClient;

function asText(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function asStructuredContent(data: unknown) {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

export function createEnvClient(): SnapshotSiteClient {
  const apiKey = process.env.SNAPSHOT_SITE_API_KEY;
  const baseUrl = process.env.SNAPSHOT_SITE_BASE_URL;

  if (!apiKey) {
    throw new Error("Missing SNAPSHOT_SITE_API_KEY environment variable");
  }

  return new SnapshotSiteClient({
    apiKey,
    baseUrl,
    userAgent: MCP_USER_AGENT,
  });
}

export function createApiKeyClient(apiKey: string, baseUrl = process.env.SNAPSHOT_SITE_BASE_URL): SnapshotSiteClient {
  if (!apiKey) {
    throw new Error("Missing Snapshot Site API key");
  }

  return new SnapshotSiteClient({
    apiKey,
    baseUrl,
    userAgent: MCP_USER_AGENT,
  });
}

export function createBearerClient(
  accessToken: string,
  baseUrl = process.env.SNAPSHOT_SITE_BASE_URL,
  requestId?: string,
): SnapshotSiteClient {
  if (!accessToken) {
    throw new Error("Missing Snapshot Site product access token");
  }

  return new SnapshotSiteClient({
    apiKey: "__internal_bearer__",
    baseUrl,
    userAgent: MCP_USER_AGENT,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.delete("X-SnapshotSiteAPI-Key");
      headers.delete("x-snapshotsiteapi-key");
      headers.set("authorization", `Bearer ${accessToken}`);
      headers.set("user-agent", MCP_USER_AGENT);
      if (requestId) {
        headers.set("x-request-id", requestId);
      }

      return fetch(input, {
        ...init,
        headers,
      });
    },
  });
}

export function createMcpServer(getClient: SnapshotSiteClientFactory): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    "screenshot",
    {
      title: "Capture Screenshot",
      description:
        "Capture a live webpage with Snapshot Site. Use this for screenshots, PDFs, HTML capture, device-sized renders, cookie hiding, custom JS injection, and export retrieval.",
      inputSchema: {
        url: z.string().url(),
        width: z.number().int().min(100).max(9999).optional(),
        height: z.number().int().min(100).max(9999).optional(),
        format: z.enum(["png", "jpeg", "jpg", "webp", "pdf", "base64", "html"]).optional(),
        delay: z.number().min(0).max(10).optional(),
        fullSize: z.boolean().optional(),
        hideCookie: z.boolean().optional(),
        javascriptCode: z.string().optional(),
        hide: z.string().optional(),
        convert: z.boolean().optional(),
        language: z.string().optional(),
        country: z.string().optional(),
      },
      annotations: {
        title: "Capture Screenshot",
        idempotentHint: true,
        readOnlyHint: true,
        openWorldHint: true,
      },
      _meta: {
        category: "capture",
        examples: [
          "Capture a full-page PNG of https://snapshot-site.com",
          "Render a PDF invoice page and return the download URL",
        ],
      },
    },
    async (input) => {
      const client = await getClient("screenshot");
      const payload: ScreenshotRequest = input;
      const result = await client.screenshot(payload);

      return {
        content: [
          {
            type: "text",
            text: asText(result),
          },
        ],
        structuredContent: asStructuredContent(result),
      };
    }
  );

  server.registerTool(
    "analyze",
    {
      title: "Analyze Webpage",
      description:
        "Capture and analyze a webpage with Snapshot Site. Useful for content summaries, SEO metadata inspection, headings extraction, and quality signals such as blank pages or captcha detection.",
      inputSchema: {
        url: z.string().url(),
        format: z.enum(["png", "jpeg", "webp", "pdf", "html"]).optional(),
        width: z.number().int().min(100).max(8000).optional(),
        height: z.number().int().min(100).max(20000).optional(),
        delay: z.number().min(0).max(10).optional(),
        fullSize: z.boolean().optional(),
        hideCookie: z.boolean().optional(),
        hide: z.string().optional(),
        javascriptCode: z.string().optional(),
        language: z.string().optional(),
        waitForDom: z.boolean().optional(),
        enableSummary: z.boolean().optional(),
        enableQuality: z.boolean().optional(),
        forceRefresh: z.boolean().optional(),
      },
      annotations: {
        title: "Analyze Webpage",
        idempotentHint: true,
        readOnlyHint: true,
        openWorldHint: true,
      },
      _meta: {
        category: "analysis",
        examples: [
          "Analyze the homepage and return summary plus metadata",
          "Check whether a page has captcha, blank rendering, or poor readability",
        ],
      },
    },
    async (input) => {
      const client = await getClient("analyze");
      const payload: AnalyzeRequest = input;
      const result = await client.analyze(payload);

      return {
        content: [
          {
            type: "text",
            text: asText(result),
          },
        ],
        structuredContent: asStructuredContent(result),
      };
    }
  );

  server.registerTool(
    "compare",
    {
      title: "Compare Page States",
      description:
        "Compare two live webpage states or two PNG captures and return before, after, diff, plus mismatch metrics. Useful for QA, release review, and visual regression workflows.",
      inputSchema: {
        before: z.object({
          url: z.string().url().optional(),
          imageUrl: z.string().url().optional(),
          width: z.number().int().min(100).max(9999).optional(),
          height: z.number().int().min(100).max(20000).optional(),
          delay: z.number().min(0).max(10).optional(),
          fullSize: z.boolean().optional(),
          hideCookie: z.boolean().optional(),
          javascriptCode: z.string().optional(),
          hide: z.string().optional(),
          language: z.string().optional(),
        }),
        after: z.object({
          url: z.string().url().optional(),
          imageUrl: z.string().url().optional(),
          width: z.number().int().min(100).max(9999).optional(),
          height: z.number().int().min(100).max(20000).optional(),
          delay: z.number().min(0).max(10).optional(),
          fullSize: z.boolean().optional(),
          hideCookie: z.boolean().optional(),
          javascriptCode: z.string().optional(),
          hide: z.string().optional(),
          language: z.string().optional(),
        }),
        threshold: z.number().min(0).max(1).optional(),
      },
      annotations: {
        title: "Compare Page States",
        idempotentHint: true,
        readOnlyHint: true,
        openWorldHint: true,
      },
      _meta: {
        category: "visual-diff",
        examples: [
          "Compare staging vs production pricing page",
          "Generate a diff image for two PNG screenshots and inspect mismatch rate",
        ],
      },
    },
    async (input) => {
      const client = await getClient("compare");
      const payload: VisualDiffRequest = input;
      const result = await client.compare(payload);

      return {
        content: [
          {
            type: "text",
            text: asText(result),
          },
        ],
        structuredContent: asStructuredContent(result),
      };
    }
  );

  return server;
}
