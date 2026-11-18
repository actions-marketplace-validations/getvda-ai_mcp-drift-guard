// Find MCP server configs in a repo: Claude Code (.mcp.json), Cursor (.cursor/mcp.json), VS Code (.vscode/mcp.json).
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const KNOWN_CONFIGS = [".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json"];

/** ${VAR} and ${VAR:-default}, as Claude Code expands them. Returns { value, missing[] }. */
export function expand(s, env = process.env) {
  const missing = [];
  const value = String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, def) => {
    if (env[name] !== undefined && env[name] !== "") return env[name];
    if (def !== undefined) return def;
    missing.push(name);
    return "";
  });
  return { value, missing };
}

function expandAll(obj, env, missing) {
  if (typeof obj === "string") { const r = expand(obj, env); missing.push(...r.missing); return r.value; }
  if (Array.isArray(obj)) return obj.map((x) => expandAll(x, env, missing));
  if (obj && typeof obj === "object") return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, expandAll(v, env, missing)]));
  return obj;
}

/** A URL with query values redacted, for the lockfile and reports (query strings often carry keys). */
export function safeTarget(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) u.searchParams.set(k, "REDACTED");
    u.username = ""; u.password = "";
    return u.toString();
  } catch { return url; }
}

export function loadServers({ cwd = process.cwd(), configs, env = process.env } = {}) {
  const files = configs?.length ? configs : KNOWN_CONFIGS.filter((f) => existsSync(join(cwd, f)));
  const servers = [];
  const problems = [];
  for (const f of files) {
    const path = join(cwd, f);
    let json;
    try { json = JSON.parse(readFileSync(path, "utf8")); } catch (e) { problems.push(`${f}: ${e.message}`); continue; }
    const map = json.mcpServers ?? json.servers ?? {};
    for (const [name, raw] of Object.entries(map)) {
      if (servers.some((s) => s.name === name)) continue; // first config wins
      const missing = [];
      const c = expandAll(raw, env, missing);
      const transport = c.type === "sse" ? "sse" : c.url ? "http" : c.command ? "stdio" : c.type ?? "unknown";
      const target = transport === "stdio" ? [c.command, ...(c.args ?? [])].join(" ") : safeTarget(c.url ?? "");
      // Template target (before expansion) keeps secrets out of the lockfile.
      const rawTarget = transport === "stdio" ? [raw.command, ...(raw.args ?? [])].join(" ") : safeTarget(raw.url ?? "");
      servers.push({ name, transport, config: c, target: rawTarget, resolvedTarget: target, missingEnv: [...new Set(missing)], file: relative(cwd, path) || f });
    }
  }
  return { files, servers, problems };
}
