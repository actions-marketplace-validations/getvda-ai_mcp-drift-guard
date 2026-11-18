// Ask an MCP server for its declared tools: Streamable HTTP, legacy SSE, or stdio.
import { spawn } from "node:child_process";

export const VERSION = "0.2.0";
const CLIENT = { name: "mcp-drift-guard", version: VERSION };
const PROTOCOL = "2025-06-18";

class RpcError extends Error {}

async function readSse(res, wantId, timeoutMs) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        try {
          const msg = JSON.parse(data);
          if (msg.id === wantId) return msg;
        } catch { /* not JSON */ }
      }
    }
  } finally { reader.cancel().catch(() => {}); }
  throw new RpcError("no response on event stream");
}

async function httpRpc(url, headers, body, state, timeoutMs) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers };
  if (state.session) h["mcp-session-id"] = state.session;
  if (state.protocol) h["mcp-protocol-version"] = state.protocol;
  const res = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) state.session = sid;
  if (body.id === undefined) return null; // notification
  if (res.status === 401 || res.status === 403) throw new RpcError(`auth required (HTTP ${res.status})`);
  if (!res.ok) throw new RpcError(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  const msg = ct.includes("text/event-stream") ? await readSse(res, body.id, timeoutMs) : await res.json();
  if (msg.error) throw new RpcError(`${body.method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  return msg.result;
}

async function listAll(call) {
  const init = await call("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT });
  await call("notifications/initialized", undefined, true);
  const tools = [];
  let cursor;
  for (let page = 0; page < 50; page++) {
    const r = await call("tools/list", cursor ? { cursor } : {});
    tools.push(...(r?.tools ?? []));
    cursor = r?.nextCursor;
    if (!cursor) break;
  }
  return { tools, serverInfo: init?.serverInfo, protocol: init?.protocolVersion };
}

async function probeHttp(server, timeoutMs) {
  const { url, headers = {} } = server.config;
  const state = {};
  let id = 0;
  const call = async (method, params, notify = false) => {
    const body = notify ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) };
    const r = await httpRpc(url, headers, body, state, timeoutMs);
    if (method === "initialize" && r?.protocolVersion) state.protocol = r.protocolVersion;
    return r;
  };
  try { return await listAll(call); }
  finally { if (state.session) fetch(url, { method: "DELETE", headers: { ...headers, "mcp-session-id": state.session } }).catch(() => {}); }
}

async function probeSse(server, timeoutMs) {
  const { url, headers = {} } = server.config;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const res = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: ctl.signal });
  if (res.status === 401 || res.status === 403) throw new RpcError(`auth required (HTTP ${res.status})`);
  if (!res.ok) throw new RpcError(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", endpoint;
  const waiting = new Map();
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const ev = /^event:\s*(.*)$/m.exec(block)?.[1]?.trim() ?? "message";
        const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
        if (ev === "endpoint") { endpoint = new URL(data, url).toString(); waiting.get("endpoint")?.(); }
        else { try { const m = JSON.parse(data); waiting.get(m.id)?.(m); } catch { /* ignore */ } }
      }
    }
  })().catch(() => {});
  const wait = (key) => new Promise((r) => waiting.set(key, r));
  try {
    if (!endpoint) await wait("endpoint");
    let id = 0;
    const call = async (method, params, notify = false) => {
      const body = notify ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) };
      const p = notify ? null : wait(body.id);
      await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      if (!p) return null;
      const m = await p;
      if (m.error) throw new RpcError(`${method}: ${m.error.message}`);
      return m.result;
    };
    return await listAll(call);
  } finally { clearTimeout(timer); ctl.abort(); void pump; }
}

async function probeStdio(server, timeoutMs, cwd) {
  const { command, args = [], env = {} } = server.config;
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
  let buf = "", stderr = "";
  const waiting = new Map();
  const exited = new Promise((_, rej) => {
    child.on("error", (e) => rej(new RpcError(`could not start: ${e.message}`)));
    child.on("exit", (code) => rej(new RpcError(`exited with code ${code}${stderr ? `: ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`)));
  });
  exited.catch(() => {});
  child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { const m = JSON.parse(line); if (m.id !== undefined) waiting.get(m.id)?.(m); } catch { /* log line */ }
    }
  });
  let id = 0;
  const call = async (method, params, notify = false) => {
    const body = notify ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) };
    child.stdin.write(JSON.stringify(body) + "\n");
    if (notify) return null;
    const m = await Promise.race([new Promise((r) => waiting.set(body.id, r)), exited]);
    if (m.error) throw new RpcError(`${method}: ${m.error.message}`);
    return m.result;
  };
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try { return await listAll(call); }
  finally { clearTimeout(timer); child.stdin.end(); child.kill(); }
}

/** Returns { ok: true, tools, serverInfo } or { ok: false, status, error }. */
export async function probe(server, { timeoutMs = 30000, cwd = process.cwd(), stdio = true } = {}) {
  if (server.missingEnv?.length) return { ok: false, status: "skipped", error: `missing env: ${server.missingEnv.join(", ")}` };
  try {
    if (server.transport === "http") return { ok: true, ...(await withTimeout(probeHttp(server, timeoutMs), timeoutMs)) };
    if (server.transport === "sse") return { ok: true, ...(await withTimeout(probeSse(server, timeoutMs), timeoutMs)) };
    if (server.transport === "stdio") {
      if (!stdio) return { ok: false, status: "skipped", error: "stdio servers disabled" };
      return { ok: true, ...(await withTimeout(probeStdio(server, timeoutMs, cwd), timeoutMs + 1000)) };
    }
    return { ok: false, status: "skipped", error: `unknown transport ${server.transport}` };
  } catch (e) {
    const msg = e?.name === "TimeoutError" || e?.name === "AbortError" ? "timed out" : e.message;
    return { ok: false, status: /auth required/.test(msg) ? "auth_required" : "unreachable", error: msg };
  }
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new RpcError("timed out")), ms); })]).finally(() => clearTimeout(t));
}
