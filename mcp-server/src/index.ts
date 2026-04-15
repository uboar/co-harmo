#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CoHarmoBridgeClient } from "./bridgeClient.js";
import { registerTools } from "./tools/index.js";

const server = new McpServer({
  name: "co-harmo",
  version: "0.0.0",
});

const bridge = new CoHarmoBridgeClient();
registerTools(server, bridge);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("co-harmo-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
