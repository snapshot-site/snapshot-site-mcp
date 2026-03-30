#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SnapshotSiteClient, } from "@snapshot-site/sdk";
function getClient() {
    const apiKey = process.env.SNAPSHOT_SITE_API_KEY;
    const baseUrl = process.env.SNAPSHOT_SITE_BASE_URL;
    if (!apiKey) {
        throw new Error("Missing SNAPSHOT_SITE_API_KEY environment variable");
    }
    return new SnapshotSiteClient({
        apiKey,
        baseUrl,
        userAgent: "@snapshot-site/mcp/0.1.0",
    });
}
function asText(data) {
    return JSON.stringify(data, null, 2);
}
function asStructuredContent(data) {
    return JSON.parse(JSON.stringify(data));
}
const server = new McpServer({
    name: "snapshot-site",
    version: "0.1.0",
});
server.registerTool("screenshot", {
    title: "Capture Screenshot",
    description: "Capture a live webpage with Snapshot Site. Use this for screenshots, PDFs, HTML capture, device-sized renders, cookie hiding, custom JS injection, and export retrieval.",
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
}, async (input) => {
    const client = getClient();
    const payload = input;
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
});
server.registerTool("analyze", {
    title: "Analyze Webpage",
    description: "Capture and analyze a webpage with Snapshot Site. Useful for content summaries, SEO metadata inspection, headings extraction, and quality signals such as blank pages or captcha detection.",
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
}, async (input) => {
    const client = getClient();
    const payload = input;
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
});
server.registerTool("compare", {
    title: "Compare Page States",
    description: "Compare two live webpage states or two PNG captures and return before, after, diff, plus mismatch metrics. Useful for QA, release review, and visual regression workflows.",
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
}, async (input) => {
    const client = getClient();
    const payload = input;
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
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown MCP server error";
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
