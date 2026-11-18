// Canonical hashing, byte-compatible with the MCP Drift Observatory ("canon_version": "1"):
// JSON with sorted keys, separators (',', ':'), UTF-8, non-ASCII emitted literally, tools sorted by name.
// That is Python's json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).
import { createHash } from "node:crypto";

export const CANON = "drift-v1";

function num(n) {
  if (!Number.isFinite(n)) throw new Error("non-finite number in tool definition");
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  // Python float repr: exponent with sign and at least two digits (1e-07, 1e+16).
  return String(n).replace(/e([+-])(\d)$/, "e$10$2").replace(/e(\d)/, "e+$1");
}

export function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(byCodePoint);
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  throw new Error(`cannot canonicalise ${typeof v}`);
}

function byCodePoint(a, b) {
  const A = [...a], B = [...b];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const d = A[i].codePointAt(0) - B[i].codePointAt(0);
    if (d) return d;
  }
  return A.length - B.length;
}

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export function sortTools(tools) {
  return [...tools].sort((a, b) => byCodePoint(String(a.name), String(b.name)));
}

export function hashTools(tools) {
  const sorted = sortTools(tools);
  const per = {};
  for (const t of sorted) per[t.name] = sha256(canonical(t));
  return { full_hash: sha256(canonical(sorted)), per_tool: per, tool_count: sorted.length };
}
