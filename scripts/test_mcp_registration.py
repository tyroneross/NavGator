#!/usr/bin/env python3
"""Tests for NavGator's opt-in MCP registration contract.

Stdlib only. Run: python3 test_mcp_registration.py

NavGator no longer registers an MCP server on either host. The CLI
(`navgator <command> --agent`) is the wired agent surface; the MCP server still
ships and still works, but only after an explicit `--with-mcp` install. These
tests assert that contract from both directions.

Checks:
  NoAutoLoadedConfig  — neither host has a config it would auto-load. Claude
                        reads a root `.mcp.json`; Codex reads the path named by
                        `.codex-plugin/plugin.json`'s `mcpServers` key. Both
                        must be absent, or a default install silently registers
                        a server again.
  OptInTemplateShape  — `mcp-optin/{claude,codex}.mcp.json` exist, are valid
                        JSON, and keep host-specific process resolution: Claude
                        resolves through `${CLAUDE_PLUGIN_ROOT}`, Codex stays
                        package-relative with `cwd: "."` and must never borrow
                        the Claude-only plugin-root variable.
  CommandResolves     — every template's referenced script exists on disk, so
                        `--with-mcp` cannot register a server that will not
                        start.
  ServerNamingHygiene — server names should be plugin-prefixed to avoid name
                        collisions across installed plugins. Informational.
  NoDuplicateNames    — within a template, every server name is unique.
  InstallerOptIn      — both installers expose the `--with-mcp` flag, default it
                        off, and copy from the frozen template paths.

The previous version of this file resolved its config through
`.claude-plugin/plugin.json`'s `mcpServers` key. NavGator never set that key
(Claude auto-loads the root `.mcp.json` by convention), so every test skipped
and the file asserted nothing. Reading the templates directly is what makes
these checks real.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

CLAUDE_PLUGIN_JSON = REPO_ROOT / ".claude-plugin" / "plugin.json"
CODEX_PLUGIN_JSON = REPO_ROOT / ".codex-plugin" / "plugin.json"

# Surfaces a host would auto-load. Both must stay absent.
CLAUDE_AUTOLOAD_CONFIG = REPO_ROOT / ".mcp.json"
CODEX_AUTOLOAD_CONFIG = REPO_ROOT / ".codex-plugin" / "mcp.json"

# Frozen opt-in template paths.
OPTIN_DIR = REPO_ROOT / "mcp-optin"
CLAUDE_TEMPLATE = OPTIN_DIR / "claude.mcp.json"
CODEX_TEMPLATE = OPTIN_DIR / "codex.mcp.json"
OPTIN_README = OPTIN_DIR / "README.md"

CLAUDE_INSTALLER = REPO_ROOT / "scripts" / "install-plugin.sh"
CODEX_INSTALLER = REPO_ROOT / "scripts" / "install-codex-plugin.sh"

PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_servers(template: Path) -> dict:
    """Return {server_name: server_config} from an opt-in template."""
    config = load_json(template)
    servers = config.get("mcpServers")
    if not isinstance(servers, dict):
        raise AssertionError(f"{template} is missing an mcpServers object")
    return servers


def expand_plugin_root(arg: str) -> str:
    """Replace ${CLAUDE_PLUGIN_ROOT} with the actual repo root path."""
    return arg.replace(PLUGIN_ROOT_VAR, str(REPO_ROOT))


class NoAutoLoadedConfigTests(unittest.TestCase):
    """A default install must register zero MCP servers on both hosts."""

    def test_claude_has_no_root_mcp_json(self) -> None:
        self.assertFalse(
            CLAUDE_AUTOLOAD_CONFIG.exists(),
            f"{CLAUDE_AUTOLOAD_CONFIG} exists — Claude would auto-load it and "
            "register an MCP server on a default install. MCP is opt-in; the "
            "template belongs at mcp-optin/claude.mcp.json.",
        )

    def test_codex_manifest_declares_no_mcp_servers(self) -> None:
        manifest = load_json(CODEX_PLUGIN_JSON)
        self.assertNotIn(
            "mcpServers", manifest,
            "the Codex manifest declares mcpServers — Codex would register a "
            "server on a default install. The installer adds this key only "
            "under --with-mcp.",
        )

    def test_codex_has_no_materialized_mcp_config(self) -> None:
        self.assertFalse(
            CODEX_AUTOLOAD_CONFIG.exists(),
            f"{CODEX_AUTOLOAD_CONFIG} exists — it is materialized from "
            "mcp-optin/codex.mcp.json by --with-mcp and must not be checked in.",
        )

    def test_claude_manifest_declares_no_mcp_servers(self) -> None:
        manifest = load_json(CLAUDE_PLUGIN_JSON)
        self.assertNotIn(
            "mcpServers", manifest,
            "the Claude manifest declares mcpServers — MCP is opt-in only.",
        )


class OptInTemplateShapeTests(unittest.TestCase):
    """The templates keep host-specific process resolution after the move."""

    def test_templates_exist(self) -> None:
        for path in (CLAUDE_TEMPLATE, CODEX_TEMPLATE, OPTIN_README):
            self.assertTrue(path.is_file(), f"missing opt-in file: {path}")

    def test_claude_template_resolves_through_plugin_root(self) -> None:
        server = load_servers(CLAUDE_TEMPLATE)["navgator"]
        self.assertEqual(server["command"], "node")
        self.assertIn(
            PLUGIN_ROOT_VAR, server["args"][0],
            "Claude must resolve the server through the plugin root it exports",
        )

    def test_codex_template_stays_package_relative(self) -> None:
        server = load_servers(CODEX_TEMPLATE)["navgator"]
        self.assertEqual(
            server,
            {"command": "node", "args": ["dist/mcp/server.js"], "cwd": "."},
            "Codex resolves relative to the package it copied into its cache",
        )
        self.assertNotIn(
            "CLAUDE_PLUGIN_ROOT", json.dumps(server),
            "the Codex template must not borrow the Claude-only plugin root",
        )

    def test_readme_carries_the_policy(self) -> None:
        text = OPTIN_README.read_text(encoding="utf-8")
        self.assertIn(
            "## Agent interface policy: CLI first, HTTP second, MCP last resort",
            text,
        )


class CommandResolvesTests(unittest.TestCase):
    def test_command_args_resolve(self) -> None:
        for template in (CLAUDE_TEMPLATE, CODEX_TEMPLATE):
            for name, cfg in load_servers(template).items():
                with self.subTest(template=template.name, server=name):
                    for arg in cfg.get("args", []):
                        expanded = Path(expand_plugin_root(arg))
                        if not expanded.suffix:
                            continue
                        # Codex args are package-relative; resolve against the repo.
                        if not expanded.is_absolute():
                            expanded = REPO_ROOT / expanded
                        self.assertTrue(
                            expanded.exists(),
                            f"server {name!r} in {template.name} references {arg!r} "
                            f"which resolves to {expanded} — not present "
                            "(run `npm run build` if TS source?)",
                        )


class ServerNamingHygieneTests(unittest.TestCase):
    """Server names should be plugin-prefixed to avoid global name collisions.

    Multiple plugins each registering server name 'debugger' will collide —
    only one wins at runtime, the others are silently shadowed. Bare names
    aren't blocked by the host, but they are a footgun. Non-blocking: this
    reports via skipTest with a hint, as it did before the opt-in migration.
    """

    def test_server_names_avoid_common_unprefixed_names(self) -> None:
        plugin_name = load_json(CLAUDE_PLUGIN_JSON).get("name", "")
        risky = {"debugger", "memory", "search", "auth", "logger", "tracer"}
        risks = sorted({
            name
            for template in (CLAUDE_TEMPLATE, CODEX_TEMPLATE)
            for name in load_servers(template)
            if name in risky and plugin_name and plugin_name not in name
        })
        if risks:
            self.skipTest(
                f"server name(s) {risks} are not plugin-prefixed and may collide "
                f"with another plugin registering the same name. Consider "
                f"renaming to e.g. {plugin_name}-{risks[0]!r}. Non-blocking — "
                "many plugins use bare names today."
            )


class NoDuplicateNamesTests(unittest.TestCase):
    def test_unique_within_each_template(self) -> None:
        for template in (CLAUDE_TEMPLATE, CODEX_TEMPLATE):
            with self.subTest(template=template.name):
                servers = load_servers(template)
                self.assertEqual(len(servers), len(set(servers)))
                self.assertIn("navgator", servers)


class InstallerOptInTests(unittest.TestCase):
    """Registration is reachable, but only behind an explicit flag."""

    def test_both_installers_default_mcp_off(self) -> None:
        for installer in (CLAUDE_INSTALLER, CODEX_INSTALLER):
            with self.subTest(installer=installer.name):
                text = installer.read_text(encoding="utf-8")
                self.assertIn('WITH_MCP="false"', text, "MCP must default to off")
                self.assertIn("--with-mcp)", text, "installer must accept --with-mcp")
                self.assertIn(
                    "MCP is off by default. Re-run with --with-mcp only if your "
                    "client cannot run a shell.",
                    text,
                )

    def test_installers_copy_from_the_frozen_templates(self) -> None:
        self.assertIn(
            "mcp-optin/claude.mcp.json",
            CLAUDE_INSTALLER.read_text(encoding="utf-8"),
        )
        self.assertIn(
            "mcp-optin/codex.mcp.json",
            CODEX_INSTALLER.read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
