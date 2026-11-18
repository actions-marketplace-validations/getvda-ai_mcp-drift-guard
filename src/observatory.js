// The thin wrapper: for remote servers this run cannot read itself (auth, a missing secret, unreachable from here),
// ask the MCP Drift Observatory what it last saw. Its hashes are byte-identical to ours, so a pin compares directly.
// This sends the server's origin and path (never its query string, credentials or headers) to drift.getvda.ai.
import { VERSION } from "./probe.js";
import { clientId } from "./rssa.js";

export const OBSERVATORY = "https://drift.getvda.ai/mcp";

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|0\.0\.0\.0)|\.(local|internal|lan|home|corp)$/i;

/** origin + path only, or null when the URL must not leave the run (private host, or a secret in the host/path). */
export function publicUrl(server) {
  const raw = server.config?.url;
  if (!raw) return null;
  // A ${VAR} we could not expand sits in the host or path: the URL is incomplete, and may be secret.
  const rawPath = (() => { try { const u = new URL(String(server.rawUrl ?? raw).replace(/\$\{[^}]+\}/g, "zzdgvarzz")); return u.host + u.pathname; } catch { return "zzdgvarzz"; } })();
  if (rawPath.includes("zzdgvarzz") && server.missingEnv?.length) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || PRIVATE.test(u.hostname)) return null;
    return u.origin + u.pathname;
  } catch { return null; }
}

async function call(tool, args, timeoutMs, env) {
  const res = await fetch(OBSERVATORY, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": `mcp-drift-guard/${VERSION} client=${clientId(env)}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`observatory HTTP ${res.status}`);
  let text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) text = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
  const msg = JSON.parse(text);
  if (msg.error) throw new Error(msg.error.message);
  return JSON.parse(msg.result?.content?.[0]?.text ?? "{}");
}

/**
 * What the observatory knows about one server: { known, full_hash, tool_count, last_changed_at, last_success_at,
 * change_count, latest_change?, witness?, server_page? } or { known: false } or { error }.
 */
export async function observe(url, { timeoutMs = 15000, withDiff = true, env = process.env } = {}) {
  try {
    const c = await call("drift_check", { url }, timeoutMs, env);
    if (!c.known || !c.full_hash) return { known: false, status: c.status, note: c.note };
    const out = {
      known: true, status: c.status, full_hash: c.full_hash, tool_count: c.tool_count, last_changed_at: c.last_changed_at,
      last_success_at: c.last_success_at, change_count: c.change_count, witness: c.witness, server_page: c.follow?.server_page,
    };
    if (withDiff && c.change_count) {
      try {
        const d = await call("drift_diff", { url }, timeoutMs, env);
        out.latest_change = d.latest_change && { at: d.latest_change.observed_at, summary: d.latest_change.summary, signals: d.latest_change.signals ?? [], to_hash: d.latest_change.to_hash };
      } catch { /* the check alone is enough */ }
    }
    return out;
  } catch (e) {
    return { error: e?.name === "TimeoutError" ? "observatory timed out" : e.message };
  }
}
