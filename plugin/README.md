# MCP Drift Guard for Claude Code

Pins the tools your project's MCP servers declare in `mcp-tools.lock.json`, and warns you at session start when a
server has changed its tool names, descriptions or schemas since you last reviewed them. Changed descriptions are
flagged for known tool-poisoning tells (hidden instructions, `<IMPORTANT>` tags, "don't tell the user", sensitive
paths, exfiltration wording, invisible Unicode). Public servers this session can't read itself are checked against the MCP Drift
Observatory's nightly record. The plugin also adds the observatory's tools for checking any public server.

Install:

```
/plugin install mcp-drift-guard --marketplace getvda-ai/mcp-drift-guard
```

Setup: ask Claude to "lock my MCP tools", then commit `mcp-tools.lock.json`. Requires Node 20+.

What runs when: the session-start check does nothing in a project without `mcp-tools.lock.json`. With one, it reads
your remote MCP servers' tool lists (it never starts local stdio servers at session start), compares them with the
lockfile, and stays silent unless something changed. It also reads the public observatory feed, and for public
servers it could not reach it asks the observatory, sending only the server's origin and path. Set
`DRIFT_GUARD_OFFLINE=1` to keep everything local. Details in the privacy policy below.

Full documentation: https://github.com/getvda-ai/mcp-drift-guard · Privacy: https://github.com/getvda-ai/mcp-drift-guard/blob/main/PRIVACY.md
