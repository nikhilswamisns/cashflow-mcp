// stdio entry: Claude Desktop and Claude Code start this as a local process
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./app.js";

await buildServer().connect(new StdioServerTransport());
