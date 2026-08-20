#!/usr/bin/env node
/**
 * NavGator MCP Server
 *
 * JSON-RPC 2.0 over stdio (MCP protocol).
 * Exposes architecture analysis tools: scan, status, impact, connections, diagram, trace, summary.
 */
import { createInterface } from "readline";
import { TOOLS, handleToolCall } from "./tools.js";
import { NAVGATOR_VERSION } from "../version.js";
// --- Lifecycle contract (mcp-lifecycle v1) ---
// See the mcp-lifecycle v1 SPEC (docs/standards/mcp-lifecycle/SPEC.md in the standards repo).
// A stdio server that exits only on stdin EOF leaks unboundedly under a host that keeps
// the pipe write-end open (parent alive, no traffic, no signal — indistinguishable from a
// quiet-but-live session). Four independent exit paths close that gap:
//   L1 stdin EOF               — already the default Node readline behaviour, unchanged below.
//   L2 SIGTERM/SIGINT/SIGHUP   — exit 0 (not the default-disposition death) within 2s.
//   L3 ppid watchdog           — poll every 5s; ppid becoming 1 means the host died. exit 0.
//   L4 idle timeout            — no inbound frame for MCP_IDLE_TIMEOUT_MS. exit 0.
// L4's default is 0 (disabled). This host does not respawn a stdio MCP server once it exits —
// its tools deregister for the rest of the session — so a non-zero default would silently strip
// tools from any conversation that went quiet. L4 is always implemented; it activates only when
// an operator sets MCP_IDLE_TIMEOUT_MS for a deployment known to reuse servers across sessions.
// No host detection: every layer here is unconditional.
function shutdown(reason) {
    process.stderr.write(`NavGator MCP server: exiting (${reason})\n`);
    // "Flush" is nominal on every exit path here, per SPEC.md — all four fire only when the
    // connection is quiescent (peer gone, host tearing down, parent dead, or no traffic at all),
    // so there is never a response in flight with a reader waiting on it.
    process.exit(0);
}
// --- L2: termination signals ---
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => shutdown(sig));
}
// --- L3: parent-death watchdog (poll every 5s; ppid 1 means reparented to init/launchd) ---
const ppidWatchdog = setInterval(() => {
    if (process.ppid === 1)
        shutdown("parent died (ppid=1)");
}, 5000);
ppidWatchdog.unref(); // never hold the event loop open on its own
// --- L4: idle timeout, disabled unless MCP_IDLE_TIMEOUT_MS is a positive number ---
const IDLE_TIMEOUT_MS = (() => {
    const raw = process.env.MCP_IDLE_TIMEOUT_MS;
    if (!raw)
        return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
})();
let idleTimer = null;
function markActivity() {
    if (IDLE_TIMEOUT_MS <= 0)
        return; // disabled by default — see header comment
    if (idleTimer)
        clearTimeout(idleTimer);
    idleTimer = setTimeout(() => shutdown(`idle for ${IDLE_TIMEOUT_MS}ms`), IDLE_TIMEOUT_MS);
    idleTimer.unref(); // never hold the event loop open on its own
}
markActivity(); // start the clock at boot too, in case no frame ever arrives
// --- JSON-RPC transport over stdio ---
const rl = createInterface({ input: process.stdin, terminal: false });
// Track concurrent frames so EOF drains responses without making a long scan
// block lightweight protocol traffic such as tools/list. The bounded drain
// preserves the lifecycle guarantee even if a tool never settles.
const inflight = new Set();
const EOF_DRAIN_TIMEOUT_MS = 30_000;
rl.on("close", () => {
    const drain = Promise.allSettled([...inflight]);
    const timeout = new Promise(resolve => {
        setTimeout(resolve, EOF_DRAIN_TIMEOUT_MS);
    });
    void Promise.race([drain, timeout]).then(() => shutdown("stdin EOF"));
});
rl.on("line", (line) => {
    markActivity(); // last inbound JSON-RPC frame, per L4
    const trimmed = line.trim();
    if (!trimmed)
        return;
    try {
        const msg = JSON.parse(trimmed);
        let task;
        task = handleMessage(msg).finally(() => inflight.delete(task));
        inflight.add(task);
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
    version: NAVGATOR_VERSION,
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