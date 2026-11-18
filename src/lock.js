// The lockfile, and the diff between it and what servers declare now.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CANON, canonical, hashTools, sortTools } from "./canon.js";
import { VERSION } from "./probe.js";

export const LOCK_VERSION = 1;

export function readLock(path) {
  if (!existsSync(path)) return null;
  const j = JSON.parse(readFileSync(path, "utf8"));
  if (j.lockfileVersion !== LOCK_VERSION) throw new Error(`${path}: lockfileVersion ${j.lockfileVersion} is not supported (expected ${LOCK_VERSION})`);
  return j;
}

export function lockEntry(server, tools) {
  const h = hashTools(tools);
  return {
    transport: server.transport,
    target: server.target,
    tool_count: h.tool_count,
    full_hash: h.full_hash,
    tools: Object.fromEntries(sortTools(tools).map((t) => [t.name, { hash: h.per_tool[t.name], definition: t }])),
  };
}

export function writeLock(path, servers) {
  const sorted = Object.fromEntries(Object.keys(servers).sort().map((k) => [k, servers[k]]));
  const doc = {
    lockfileVersion: LOCK_VERSION,
    generator: `mcp-drift-guard@${VERSION}`,
    canon: `${CANON}: JSON, sorted keys, compact, UTF-8 literal, tools sorted by name (same bytes as the MCP Drift Observatory's drift_hash)`,
    servers: sorted,
  };
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

// Heuristic tells of tool poisoning in a description. Signals, not verdicts.
const SIGNALS = [
  ["hidden_instructions", /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts?)/i],
  ["instruction_tags", /<\s*\/?\s*(important|system|instructions?|secret|admin)\b[^>]*>/i],
  ["conceal_from_user", /\b(do not|don't|never) (tell|inform|mention|show|reveal)[^.]{0,40}\b(user|human)/i],
  ["sensitive_paths", /(~\/\.ssh|id_rsa|\.aws\/credentials|\.env\b|private[ _-]key|mcp\.json|\.cursor\/)/i],
  ["exfil_wording", /\b(send|upload|post|forward|exfiltrate)\b[^.]{0,60}\b(credentials?|secrets?|tokens?|passwords?|api[ _-]?keys?|conversation|chat history)/i],
  ["invisible_unicode", /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u],
  ["cross_tool_override", /\b(instead of|rather than|before using|whenever you use)\b[^.]{0,40}\btool\b/i],
];

export function signalsFor(text = "", before = "") {
  const out = [];
  for (const [name, re] of SIGNALS) if (re.test(text) && !re.test(before)) out.push(name);
  if (before && text.length > 2 * before.length + 80) out.push("description_length_more_than_doubled");
  return out;
}

function allText(def) {
  // Descriptions anywhere in the tool, including inside inputSchema properties.
  const parts = [];
  const walk = (v, k) => {
    if (typeof v === "string" && (k === "description" || k === "title")) parts.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(def);
  return parts.join("\n");
}

/** Compare a locked server with fresh tools. */
export function diffServer(locked, tools) {
  const fresh = lockEntry({ transport: locked.transport, target: locked.target }, tools);
  if (fresh.full_hash === locked.full_hash) return { changed: false, fresh };
  const added = [], removed = [], changed = [];
  for (const [name, t] of Object.entries(fresh.tools)) {
    const old = locked.tools[name];
    if (!old) { added.push({ name, signals: signalsFor(allText(t.definition)) }); continue; }
    if (old.hash === t.hash) continue;
    const fields = [...new Set([...Object.keys(old.definition), ...Object.keys(t.definition)])]
      .filter((k) => canonical(old.definition[k]) !== canonical(t.definition[k])).sort();
    changed.push({ name, fields, signals: signalsFor(allText(t.definition), allText(old.definition)) });
  }
  for (const name of Object.keys(locked.tools)) if (!fresh.tools[name]) removed.push({ name });
  return { changed: true, fresh, added, removed, changedTools: changed, signals: [...added, ...changed].flatMap((x) => x.signals.map((s) => `${x.name}: ${s}`)) };
}
