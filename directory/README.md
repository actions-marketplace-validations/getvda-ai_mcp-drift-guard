# MCP Drift Observatory for Claude

Ask Claude whether a public MCP server has changed the tools it declares, and see exactly what changed: which tool,
and whether its name, description, schema or annotations moved. A server that quietly rewrites a tool description
changes what your agent is told to do, so this is how you notice a rug-pull or a poisoned tool.

The plugin adds the observatory's read-only MCP server (`https://drift.getvda.ai/mcp`) and a skill that tells Claude
how to use it. It runs nothing on your machine.

Install:

```
/plugin install mcp-drift-observatory --marketplace getvda-ai/mcp-drift-guard
```

Then ask, for example: "Has https://example.com/mcp changed its tools recently?"

## What the observatory covers

It reads public MCP servers nightly and records every change of their declared tools, with a signed public feed of
every change. It can only see servers that answer without a login, so for many servers it will say "not observed".
To pin every server in your own project, including private ones, use the
[MCP Drift Guard GitHub Action](https://github.com/marketplace/actions/mcp-drift-guard).

## Privacy

`drift_check`, `drift_diff` and `drift_probe` send the server URL you ask about to getvda.ai, which tells us that
someone checked that server. Claude asks you first. `drift_status` and `drift_hash` send nothing about you. No
account, no cookies, nothing sold or shared. Full policy:
https://github.com/getvda-ai/mcp-drift-guard/blob/main/PRIVACY.md

Support: https://github.com/getvda-ai/mcp-drift-guard/issues
