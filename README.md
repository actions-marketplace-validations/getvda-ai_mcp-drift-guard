# MCP Drift Guard

**A lockfile for the tools your MCP servers declare.** It fails CI, or warns you when a Claude Code session starts, as soon
as a server you depend on changes its tool names, descriptions or schemas.

Tool definitions go straight into your agent's prompt. A server that rewrites a description (a "rug pull") changes
what your agent does, and nothing in your repo changes. `npm` has `package-lock.json`. Your MCP tools now have
`mcp-tools.lock.json`.

```text
⚠️ local  stdio  3 tools  drifted
- added   send_notes 🚩 exfil_wording
- changed get_weather: description 🚩 instruction_tags, conceal_from_user, sensitive_paths
```

- Works with **every** server you can reach: remote (Streamable HTTP, legacy SSE) and local (stdio), including
  servers behind auth. Your secrets stay in your CI.
- **And the public ones you can't.** When this run can't read a remote server (no secret in this job, blocked from the
  runner, down right now), it falls back to the MCP Drift Observatory's last nightly observation and compares hashes.
  You can even pin a server you have never connected to. See [Observatory fallback](#observatory-fallback).
- Reads `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor) and `.vscode/mcp.json` (VS Code), with `${VAR}` expansion.
- Shows a field-level diff (`description`, `inputSchema`, `annotations`…) and flags known tool-poisoning tells:
  hidden instructions, `<IMPORTANT>` tags, "don't tell the user", sensitive paths, exfiltration wording, invisible
  Unicode, cross-tool overrides, descriptions that more than double in length. These are signals, not verdicts.
- Hashes are byte-identical to the [MCP Drift Observatory](https://drift.getvda.ai)'s `drift_hash` (`canon_version` 1), so you can compare your
  pins with a public, independent record.

## Quick start

```bash
npx mcp-drift-guard lock     # probe your servers, write mcp-tools.lock.json, then commit it
npx mcp-drift-guard check    # exit 1 if anything changed
npx mcp-drift-guard update   # accept the change after you've reviewed it (then check the git diff)
npx mcp-drift-guard observe https://mcp.example.com/mcp   # any public server, no config needed
```

## GitHub Action

```yaml
- uses: actions/checkout@v6
- uses: getvda-ai/mcp-drift-guard@v0
  env:
    EXAMPLE_API_KEY: ${{ secrets.EXAMPLE_API_KEY }}   # anything your .mcp.json references as ${VAR}
```

Run it on pull requests **and on a daily schedule**: servers change without a commit on your side. See
[`examples/mcp-drift-guard.yml`](examples/mcp-drift-guard.yml), which also opens an issue when the nightly run finds drift.

| Input | Default | |
|---|---|---|
| `mode` | `check` | `check`, `update` or `lock` |
| `lockfile` | `mcp-tools.lock.json` | |
| `config` | the three files above | comma- or newline-separated |
| `fail-on` | `any` | `any`, `signals` (only changes that carry a poisoning signal) or `never` |
| `stdio` | `true` | `false` checks remote servers only |
| `timeout-ms` | `30000` | per server |
| `observatory` | `true` | fall back to the observatory for remote servers this run can't read |
| `public-feed` | `true` | the public history cross-check below |
| `reader-card` | | your A2A Agent Card URL, if you have one |

Outputs: `drift`, `signals`, `report` (Markdown, also written to the job summary) and `json`.

`stdio: true` runs the commands in your MCP config, as Claude Code or Cursor would. A pull request that edits
`.mcp.json` can therefore run code in CI, as it already can through your test scripts. Use `stdio: false` on
untrusted pull requests if that matters for your repo.

## Claude Code plugin

```text
/plugin marketplace add getvda-ai/mcp-drift-guard
/plugin install mcp-drift-guard@getvda
```

- **At session start** it checks your remote servers against the lockfile. It stays silent unless something drifted;
  then it tells you, and tells Claude to treat the changed descriptions as unreviewed.
- **A skill** that locks, checks and explains drift on request, and never accepts a change without you.
- **The MCP Drift Observatory's tools** (`drift_check`, `drift_diff`, `drift_probe`, `drift_status`, `drift_hash`) for public
  servers. The skill asks before sending a server URL to them.

## Observatory fallback

A remote server can't be read from a run when its secret isn't in that job, when a firewall blocks the runner, or when
it's down. Before, that server just showed "not checked". Now, for public `https` servers, mcp-drift-guard asks the
[MCP Drift Observatory](https://drift.getvda.ai) what it saw at its last nightly crawl (`drift_check`, plus `drift_diff`
when there were changes) and compares that hash with your pin. The hashes are the same bytes, so the comparison is exact.

The observatory is also a public MCP connector you can add to any client (`https://drift.getvda.ai/mcp`, no auth):
[![MCP Drift Observatory MCP connector](https://glama.ai/mcp/connectors/ai.getvda/integration-agent/badges/score.svg)](https://glama.ai/mcp/connectors/ai.getvda/integration-agent)

| Locally | Observatory | Result |
|---|---|---|
| read OK | (not asked) | full diff, as before |
| can't read | knows it, same hash as your pin | ✅ unchanged (via observatory, with the date it was seen) |
| can't read | knows it, different hash | ⚠️ drifted, with the observatory's change summary and a link to its tool-level diff |
| can't read | doesn't know it | not checked |

- `lock` pins such a server from the observatory's hash alone. There is no stored definition to diff yet, so the first
  `update` after you can read it stores the full definitions.
- Observations older than 7 days are marked **stale**.
- **What leaves the run:** each such server's origin and path, for example `https://mcp.example.com/mcp`. Never the
  query string, headers, credentials or tool definitions. Hosts that look private (`localhost`, `10.x`, `192.168.x`,
  `.internal`, `.corp`…), plain `http`, and URLs with an unexpanded `${VAR}` in the host or path are never sent.
- It covers what the observatory can see: public servers that answer without auth. Turn it off with `observatory: false`,
  `--no-observatory` or `DRIFT_GUARD_OFFLINE=1`.

## The public history cross-check, over RSS-A

The [MCP Drift Observatory](https://github.com/mikerawsonnz/mcp-drift-observatory) crawls public MCP servers every night,
hashes what each declares and publishes every change as a **signed feed**. It uses [RSS-A](https://github.com/getvda-ai/rssa)
(RSS for Agents), an open protocol: an ordinary Atom/RSS feed that is linked from the publisher's A2A Agent Card,
with every entry signed by the publisher's key.

On each run, mcp-drift-guard reads the last 14 days of that feed, **verifies every signature**, and adds a public history
to the report, for example "this server changed its tools on 6 of the last 14 days". Only the feed is fetched: your
server list, config and tool definitions never leave the run. The request carries a short anonymous client id (a hash
of the repository name in CI, a random id locally) so the publisher can count distinct readers, never who they are.
Turn it off with `public-feed: false`, `--no-public-feed` or `DRIFT_GUARD_OFFLINE=1`.

You can subscribe to the same feed in any feed reader:
<https://hub.rssa.getvda.ai/network/@getvda-mcp-drift-observa-e131.atom>

## What it can't see

It compares **declarations**, not behaviour. A server that keeps its tool list byte-identical while changing what the
tools do is invisible to this check, and to every other client-side check. Servers that are unreachable or need
credentials you didn't provide are reported as "not checked", never as "unchanged".

## Licence and privacy

Apache-2.0. Maintained by [getvda.ai](https://getvda.ai) (Rawson Consulting B.V.). See [PRIVACY.md](PRIVACY.md).
