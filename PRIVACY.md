# Privacy

MCP Drift Guard is maintained by Rawson Consulting B.V. (getvda.ai), Eosstraat 169, 1076 DT Amsterdam, the Netherlands.

**The lockfile check** (`lock`, `check`, `update`, the GitHub Action, the Claude Code session-start hook) connects only to:

1. **Your own MCP servers**, as listed in your MCP config, to read their declared tools.
2. **The public MCP Drift Observatory feed** (`hub.rssa.getvda.ai`, and the publisher's Agent Card and keys on
   `drift.getvda.ai` and `storage.googleapis.com`), unless you turn it off. The request carries the tool's name and
   version and a 12-character anonymous client id: a SHA-256 hash of the repository name in GitHub Actions, or a random
   id stored on your machine otherwise. It carries no server URLs, config, tool definitions or secrets. The hub keeps
   one row per distinct reader per day to count readers.
3. **The observatory fallback** (`drift.getvda.ai/mcp`), on by default, only for remote servers the run could not read
   itself. For each such server it sends the server's origin and path (no query string, headers, credentials or tool
   definitions), plus the same anonymous client id. Private-looking hosts, plain `http` and incomplete URLs are never sent.
   This tells getvda.ai that someone checked that public server. Turn it off with `observatory: false`, `--no-observatory`
   or `DRIFT_GUARD_OFFLINE=1`.

**The Claude Code plugin's MCP server** (`drift.getvda.ai/mcp`) is used only when Claude calls one of its tools.
`drift_check`, `drift_diff` and `drift_probe` send the server URL you ask about, which tells getvda.ai that you use that
server. The plugin's skill asks you before calling them. `drift_status` and `drift_hash` send nothing about you.

No accounts, no cookies, and no data is sold or shared. `DRIFT_GUARD_OFFLINE=1` turns off everything except your own servers.

Contact: open an issue at https://github.com/getvda-ai/mcp-drift-guard/issues.
