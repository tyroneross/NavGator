# NavGator MCP — opt-in, last resort

## Agent interface policy: CLI first, HTTP second, MCP last resort

**CLI first — the default, always.** `navgator <command> --agent` is the wired
surface for every agent-facing operation on both Claude Code and Codex. Each call
spawns a fresh process, so it reads current on-disk state, returns a real exit
code, and writes a stable `{command, data, schema_version, timestamp}` envelope
to stdout. It costs zero context until it is called.

**Local HTTP API second — for process boundaries only.** The loopback dashboard
(`navgator ui`) serves read routes under `web/app/api/`. Use it when a separate,
already-running process needs a request/response boundary. It is not an agent
surface: an agent that can run a shell should run the CLI.

**MCP last resort — deprecated as a default, opt-in only.** NavGator no longer
registers an MCP server on either host. The server code still ships and still
works; opt in with `--with-mcp` on either installer. Use it only for a consumer
that genuinely cannot spawn a subprocess — no shell, no Bash tool. Three failure
modes drove the demotion:

- **Startup state caching.** The server is a long-lived process. State it reads at
  startup can go stale against the working tree while the session continues, so a
  tool can answer from a snapshot the user has already changed. A CLI call
  re-reads on every invocation.
- **Silent failure.** A failed handshake or a crashed server surfaces as a missing
  tool, not an error. A CLI call returns a non-zero exit code and stderr you can
  act on.
- **Context cost.** Twelve tool schemas load into every request whether or not the
  session touches architecture. The CLI costs nothing until it is called.

Opting in:

    bash scripts/install-plugin.sh --global --with-mcp        # Claude Code
    bash scripts/install-codex-plugin.sh --user --with-mcp    # Codex

Without `--with-mcp`, no MCP server is registered on either host.

## What still works without MCP

Everything. Every MCP tool has a CLI equivalent. All of them return the same data
in the `--agent` envelope except `diagram`, which emits Mermaid text:

| MCP tool | CLI replacement |
|---|---|
| `scan` | `navgator scan --agent` (add `--quick` for the fast path) |
| `status` | `navgator status --agent` |
| `impact` | `navgator impact <component> --agent` |
| `connections` | `navgator connections <component> --agent` |
| `diagram` | `navgator diagram` (emits Mermaid text; no `--agent` envelope) |
| `trace` | `navgator trace <component> --agent` |
| `summary` | `navgator summary --agent` |
| `rules` | `navgator rules --agent` |
| `portfolio` | `navgator portfolio [dir] --agent` |
| `arch_diff` | `navgator arch-diff --agent` |
| `review` | `navgator review [--component <c>] --agent` |
| `explore` | `navgator explore <component> [--depth N] --agent` |

## Files in this directory

| File | Host | Copied to |
|---|---|---|
| `claude.mcp.json` | Claude Code | `<package>/.mcp.json` by `scripts/install-plugin.sh --with-mcp` |
| `codex.mcp.json` | Codex | `<package>/.codex-plugin/mcp.json` by `scripts/install-codex-plugin.sh --with-mcp` |

Neither file is read by any host unless the matching installer runs with
`--with-mcp`. They are templates, not active configuration.
