/**
 * MCP server entry for the ClawPilot service.
 *
 * Exposes hub-side skills/tools to the external ClawPilot agent over MCP. The
 * server is the boundary; nothing here calls into other services directly.
 *
 * Scaffold only — the MCP transport + skill registration are left as TODO.
 */

export async function startMcpServer(): Promise<void> {
  // TODO: instantiate the MCP server, register skills (computer-use tools), and
  // bind the transport (stdio / socket). Gate each tool behind least-privilege
  // permission checks before forwarding to the CommandQueue.
}

// TODO: add a standalone launcher (e.g. `node ./dist/mcp-server.js`) once the
// server is implemented and @types/node is wired into this package.
