#!/usr/bin/env node
/**
 * NavGator MCP Server
 *
 * JSON-RPC 2.0 over stdio (MCP protocol).
 * Exposes architecture analysis tools: scan, status, impact, connections, diagram, trace, summary.
 */
import { createInterface } from "readline";
import { TOOLS, handleToolCall } from "./tools.js";
// --- JSON-RPC transport over stdio ---
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed)
        return;
    try {
        const msg = JSON.parse(trimmed);
        handleMessage(msg);
    }
    catch {
        // Each line should be one complete JSON-RPC message.
        // Log malformed lines to stderr and move on — don't accumulate.
        process.stderr.write(`NavGator: malformed JSON-RPC line: ${trimmed.slice(0, 200)}\n`);
    }
});
function send(msg) {
    process.stdout.write(JSON.stringify(msg) + "\n");
}
function sendResult(id, result) {
    send({ jsonrpc: "2.0", id, result });
}
function sendError(id, code, message) {
    send({ jsonrpc: "2.0", id, error: { code, message } });
}
// --- MCP Protocol ---
const SERVER_INFO = {
    name: "navgator",
    version: "0.8.2",
};
const CAPABILITIES = {
    tools: {},
};
// --- Message handler ---
async function handleMessage(msg) {
    if (msg.jsonrpc !== "2.0")
        return;
    const { id, method, params } = msg;
    try {
        switch (method) {
            case "initialize": {
                sendResult(id, {
                    protocolVersion: "2025-11-25",
                    serverInfo: SERVER_INFO,
                    capabilities: CAPABILITIES,
                });
                break;
            }
            case "notifications/initialized": {
                // Client acknowledged — no response needed
                break;
            }
            case "tools/list": {
                sendResult(id, { tools: TOOLS });
                break;
            }
            case "tools/call": {
                const { name, arguments: args } = params;
                const result = await handleToolCall(name, args || {});
                sendResult(id, result);
                break;
            }
            default: {
                if (id !== undefined) {
                    sendError(id, -32601, `Method not found: ${method}`);
                }
            }
        }
    }
    catch (err) {
        if (id !== undefined) {
            sendError(id, -32000, err instanceof Error ? err.message : "Internal error");
        }
    }
}
// Log to stderr so it doesn't interfere with the protocol
process.stderr.write("NavGator MCP server started\n");
//# sourceMappingURL=server.js.map