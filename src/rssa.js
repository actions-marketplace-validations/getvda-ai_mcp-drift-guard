// Cross-check against the MCP Drift Observatory's signed public feed, read over RSS-A.
// Only the feed is fetched: no server URL, config or tool definition leaves your machine.
import { readFeed } from "@rss-a/sdk";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { VERSION } from "./probe.js";

// The observatory's feed as merged by the RSS-A hub (signatures still verify end to end).
export const GROUP_FEED = "https://hub.rssa.getvda.ai/g/6a3a4c228e34/feed.atom";
export const DRIFT_FEED = "https://storage.googleapis.com/c2md-493808-gosce-rssa/feeds/drift/feed.rss";
export const FOLLOW = "https://hub.rssa.getvda.ai/network/@getvda-mcp-drift-observa-e131.atom?via=drift-guard";

/** A stable, anonymous client id: hashed repo name in CI, a random local id otherwise. Never the repo name itself. */
export function clientId(env = process.env) {
  if (env.GITHUB_REPOSITORY) return createHash("sha256").update(`github:${env.GITHUB_REPOSITORY}`).digest("hex").slice(0, 12);
  const dir = env.CLAUDE_PLUGIN_DATA || join(homedir(), ".config", "mcp-drift-guard");
  const f = join(dir, "client-id");
  try {
    if (existsSync(f)) return readFileSync(f, "utf8").trim();
    mkdirSync(dirname(f), { recursive: true });
    const id = createHash("sha256").update(randomUUID()).digest("hex").slice(0, 12);
    writeFileSync(f, id);
    return id;
  } catch { return "anon"; }
}

export function userAgent({ readerCard, env = process.env } = {}) {
  const base = `mcp-drift-guard/${VERSION} (+https://github.com/getvda-ai/mcp-drift-guard) rssa-sdk/0.3`;
  return readerCard ? `${base} reader=${readerCard}` : `${base} client=${clientId(env)}`;
}

const norm = (u) => { try { const x = new URL(u); return (x.origin + x.pathname).replace(/\/+$/, "").toLowerCase(); } catch { return String(u).toLowerCase(); } };

/**
 * Read the signed observatory digests (last `days`) and say which of your http servers it also saw change.
 * Returns { ok, verified, digests, seen: { [serverName]: [{ at, entryId }] }, problems }.
 */
export async function observatory(servers, { days = 14, readerCard, timeoutMs = 15000, env = process.env } = {}) {
  const ua = userAgent({ readerCard, env });
  const fetcher = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), "user-agent": ua }, signal: AbortSignal.timeout(timeoutMs) });
  try {
    const r = await readFeed(GROUP_FEED, { fetcher, readerCard });
    const since = Date.now() - days * 86400_000;
    const digests = r.entries.filter((e) => e.from === DRIFT_FEED && Date.parse(e.updated) >= since && /drift/i.test(e.title ?? e.summary ?? ""));
    const wanted = new Map(servers.filter((s) => s.transport === "http" || s.transport === "sse").map((s) => [norm(s.resolvedTarget ?? s.target), s.name]));
    const seen = {};
    for (const d of digests) {
      const urls = `${d.summary ?? ""}\n${d.content ?? ""}`.match(/https?:\/\/[^\s,<>"]+/g) ?? [];
      for (const u of urls) {
        const name = wanted.get(norm(u));
        if (name) (seen[name] ??= []).push({ at: d.updated, entryId: d.id, verified: d.verified });
      }
    }
    return { ok: true, verified: digests.every((d) => d.verified), digests: digests.length, unsigned: digests.filter((d) => !d.verified).length, seen, problems: r.problems };
  } catch (e) {
    return { ok: false, error: e.message, seen: {} };
  }
}
