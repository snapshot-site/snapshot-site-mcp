#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEnvClient, createMcpServer } from "./mcpServer.js";
const server = createMcpServer(createEnvClient);
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown MCP server error";
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
