// lock / check / update, and the report. Shared by the CLI, the GitHub Action and the Claude Code hook.
import { loadServers } from "./config.js";
import { diffServer, lockEntry, readLock, writeLock } from "./lock.js";
import { probe } from "./probe.js";
import { observe, publicUrl } from "./observatory.js";
import { FOLLOW, observatory } from "./rssa.js";

const STALE_MS = 7 * 86400_000;

export async function run(opts) {
  const { mode = "check", cwd = process.cwd(), lockfile = "mcp-tools.lock.json", configs, stdio = true, timeoutMs = 30000,
    publicFeed = true, observatory: useObservatory = true, readerCard, only, env = process.env } = opts;
  const { files, servers: all, problems } = loadServers({ cwd, configs, env });
  const servers = only ? all.filter(only) : all;
  const lockPath = lockfile.startsWith("/") ? lockfile : `${cwd}/${lockfile}`;
  const lock = readLock(lockPath);
  if (mode === "check" && !lock) return { mode, error: `no lockfile at ${lockfile}: run \`mcp-drift-guard lock\` first and commit it`, files, problems, results: [] };

  const probes = await Promise.all(servers.map(async (s) => {
    const p = await probe(s, { timeoutMs, cwd, stdio });
    // The thin wrapper: a remote server this run cannot read is checked against the observatory's record.
    let obs;
    if (!p.ok && useObservatory && (s.transport === "http" || s.transport === "sse")) {
      const url = publicUrl(s);
      obs = url ? await observe(url, { env }) : { private: true };
    }
    return [s, p, obs];
  }));
  const results = [];
  const nextLock = { ...(lock?.servers ?? {}) };
  for (const [s, p, obs] of probes) {
    const locked = lock?.servers?.[s.name];
    if (!p.ok && obs?.known) {
      const stale = Date.now() - Date.parse(obs.last_success_at ?? 0) > STALE_MS;
      const base = { name: s.name, transport: s.transport, target: s.target, tool_count: obs.tool_count, via: "observatory", localError: p.error,
        observedAt: obs.last_success_at, stale, serverPage: obs.server_page };
      const entry = { transport: s.transport, target: s.target, tool_count: obs.tool_count, full_hash: obs.full_hash, source: "observatory", observed_at: obs.last_success_at, tools: {} };
      if (!locked) {
        results.push({ ...base, status: mode === "check" ? "unlocked" : "locked" });
        if (mode !== "check") nextLock[s.name] = entry;
      } else if (locked.full_hash === obs.full_hash) {
        results.push({ ...base, status: "unchanged" });
      } else {
        const lc = obs.latest_change;
        results.push({ ...base, status: "drifted", added: [], removed: [], changedTools: [], observatoryChange: lc,
          signals: (lc?.signals ?? []).map((x) => `observatory: ${x}`) });
        if (mode !== "check") nextLock[s.name] = locked.tools && Object.keys(locked.tools).length && locked.source !== "observatory" ? { ...entry, previous_definitions_dropped: true } : entry;
      }
      continue;
    }
    if (!p.ok) {
      const cover = obs ? (obs.private ? "private or incomplete URL, not sent to the observatory" : obs.error ? `observatory: ${obs.error}` : "not in the observatory either") : undefined;
      results.push({ name: s.name, transport: s.transport, target: s.target, status: p.status, error: p.error, coverage: cover, locked: !!locked });
      continue;
    }
    if (!locked) {
      results.push({ name: s.name, transport: s.transport, target: s.target, status: mode === "check" ? "unlocked" : "locked", tool_count: p.tools.length, serverInfo: p.serverInfo });
      nextLock[s.name] = lockEntry(s, p.tools);
      continue;
    }
    const d = diffServer(locked, p.tools);
    if (d.changed && locked.source === "observatory") { d.added = []; d.removed = []; d.changedTools = []; d.signals = []; d.noDefinitions = true; }
    results.push({ name: s.name, transport: s.transport, target: s.target, status: d.changed ? "drifted" : "unchanged", tool_count: p.tools.length, serverInfo: p.serverInfo,
      ...(d.changed ? { added: d.added, removed: d.removed, changedTools: d.changedTools, signals: d.signals, noDefinitions: d.noDefinitions } : {}) });
    nextLock[s.name] = d.fresh;
  }
  const names = new Set(servers.map((s) => s.name));
  if (!only) for (const name of Object.keys(lock?.servers ?? {})) if (!names.has(name)) {
    results.push({ name, transport: lock.servers[name].transport, target: lock.servers[name].target, status: "removed_from_config" });
    if (mode !== "check") delete nextLock[name];
  }
  if (mode === "lock" || mode === "update") writeLock(lockPath, nextLock);

  const obs = publicFeed ? await observatory(servers, { readerCard, env }) : null;
  const drift = results.some((r) => ["drifted", "unlocked", "removed_from_config"].includes(r.status));
  const signals = results.flatMap((r) => (r.signals ?? []).map((s) => `${r.name} / ${s}`));
  const viaObservatory = results.filter((x) => x.via === "observatory").length;
  return { mode, files, problems, results, drift, signals, observatory: obs, viaObservatory, lockfile };
}

const icon = { unchanged: "✅", drifted: "⚠️", unlocked: "🆕", locked: "🔒", removed_from_config: "➖", auth_required: "🔐", unreachable: "❔", skipped: "⏭️" };

export function report(r, { title = "MCP tool drift" } = {}) {
  if (r.error) return `## ${title}\n\n❌ ${r.error}\n`;
  const L = [`## ${title}`, ""];
  if (!r.results.length) L.push(`No MCP servers found (looked in ${r.files.length ? r.files.join(", ") : ".mcp.json, .cursor/mcp.json, .vscode/mcp.json"}).`, "");
  const head = r.mode === "check"
    ? (r.drift ? `**Drift found.** A server's declared tools no longer match \`${r.lockfile}\`. Tool names and descriptions go straight into your agent's prompt, so review before you accept: \`npx mcp-drift-guard update\`.` : `**No drift.** Every reachable server declares exactly the tools in \`${r.lockfile}\`.`)
    : `Wrote \`${r.lockfile}\`. Commit it: changes to it are your review point.`;
  L.push(head, "");
  if (r.signals.length) L.push(`🚩 **Signals worth a close look** (heuristics, not verdicts): ${r.signals.map((s) => `\`${s}\``).join(", ")}`, "");
  L.push("| | Server | Transport | Tools | Status |", "|---|---|---|---|---|");
  for (const x of r.results) {
    const via = x.via === "observatory" ? ` (via observatory, seen ${String(x.observedAt ?? "").slice(0, 10)}${x.stale ? ", stale" : ""}; local: ${x.localError})` : "";
    L.push(`| ${icon[x.status] ?? ""} | \`${x.name}\` | ${x.transport} | ${x.tool_count ?? "–"} | ${x.status.replace(/_/g, " ")}${via}${x.error ? `: ${x.error}` : ""}${x.coverage ? ` (${x.coverage})` : ""} |`);
  }
  for (const x of r.results.filter((y) => y.status === "drifted")) {
    L.push("", `### \`${x.name}\``);
    for (const t of x.added) L.push(`- **added** \`${t.name}\`${t.signals.length ? ` 🚩 ${t.signals.join(", ")}` : ""}`);
    for (const t of x.removed) L.push(`- **removed** \`${t.name}\``);
    for (const t of x.changedTools) L.push(`- **changed** \`${t.name}\`: ${t.fields.join(", ")}${t.signals.length ? ` 🚩 ${t.signals.join(", ")}` : ""}`);
    if (x.via === "observatory") L.push(`- the observatory's hash no longer matches your pin${x.observatoryChange ? `; its latest change (${x.observatoryChange.at.slice(0, 10)}): ${x.observatoryChange.summary}` : ""}. Tool-level detail: ${x.serverPage ?? "drift_diff"}`);
    if (x.noDefinitions) L.push(`- pinned from the observatory (hash only), so there is no stored definition to diff. Run \`update\` after review to store the full definitions.`);
  }
  if (r.viaObservatory) L.push("", `<sub>${r.viaObservatory} server(s) this run could not read were checked against the MCP Drift Observatory's last nightly observation (hashes are byte-identical to yours). Only each server's origin and path were sent, never query strings, headers or credentials. Turn off with \`observatory: false\` / \`--no-observatory\`.</sub>`);
  const o = r.observatory;
  if (o) {
    L.push("");
    if (!o.ok) L.push(`<sub>Public cross-check skipped: ${o.error}</sub>`);
    else {
      const hits = Object.entries(o.seen);
      const sig = o.verified ? "signatures verified ✓" : `${o.unsigned} digests unverified`;
      if (hits.length) {
        L.push(`**Public history** (MCP Drift Observatory, ${o.digests} signed digests from the last 14 days, ${sig}):`);
        for (const [n, v] of hits) {
          const dates = [...new Set(v.map((e) => e.at.slice(0, 10)))].sort().reverse();
          const mine = r.results.find((x) => x.name === n)?.status;
          L.push(`- \`${n}\` changed its declared tools on ${dates.length} day(s), latest ${dates[0]}${mine === "drifted" ? ": corroborates the drift above" : dates.length >= 3 ? ": a server that changes often, so pin with care" : ""}`);
        }
        L.push(`<sub>Read over [RSS-A](https://github.com/getvda-ai/rssa). Only the public feed is fetched: your server list never leaves this run.</sub>`);
      } else L.push(`<sub>Public cross-check: ${o.digests} signed observatory digests from the last 14 days read over [RSS-A](https://github.com/getvda-ai/rssa) (${sig}); none mention your public servers. Only the feed is fetched: your server list never leaves this run.</sub>`);
    }
    L.push(`<sub>Follow every public MCP tool change: [signed feed](${FOLLOW}) · [mcp-drift-guard](https://github.com/getvda-ai/mcp-drift-guard)</sub>`);
  }
  return L.join("\n") + "\n";
}
