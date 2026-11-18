# MCP Drift Guard for Claude Code

Pins the tools your project's MCP servers declare in `mcp-tools.lock.json`, and warns you at session start when a
server has changed its tool names, descriptions or schemas since you last reviewed them. Changed descriptions are
flagged for known tool-poisoning tells (hidden instructions, `<IMPORTANT>` tags, "don't tell the user", sensitive
paths, exfiltration wording, invisible Unicode). The plugin also adds the MCP Drift Observatory's tools for checking
public servers.

Setup: ask Claude to "lock my MCP tools", then commit `mcp-tools.lock.json`. Requires Node 20+.

Full documentation: https://github.com/getvda-ai/mcp-drift-guard · Privacy: https://github.com/getvda-ai/mcp-drift-guard/blob/main/PRIVACY.md
