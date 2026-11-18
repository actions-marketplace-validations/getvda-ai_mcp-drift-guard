import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnArgs } from "../src/probe.js";
import { run } from "../src/run.js";

test("non-Windows: command and args pass through untouched", () => {
  assert.deepEqual(spawnArgs("npx", ["-y", "pkg"], "linux"), ["npx", ["-y", "pkg"], {}]);
});

test("Windows: an .exe path with a space is started directly, no shell", () => {
  const exe = "C:\\Program Files\\nodejs\\node.exe";
  assert.deepEqual(spawnArgs(exe, ["a b.js"], "win32"), [exe, ["a b.js"], {}]);
});

test("Windows: a shim goes through cmd, quoting only the tokens that need it", () => {
  const [cmd, argv, extra] = spawnArgs("npx", ["-y", "C:\\a b\\x.js"], "win32");
  assert.match(cmd, /cmd(\.exe)?$/i);
  assert.deepEqual(argv.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(argv[3], '"npx -y "C:\\a b\\x.js""');
  assert.equal(extra.windowsVerbatimArguments, true);
});

// The real thing: a .cmd shim in a folder with a space, launching the mock server
// from a path with a space. Before the fix, `shell: true` split "C:\Program Files"
// and the server was reported unreachable.
test("Windows: a .cmd server under a spaced path is probed", { skip: process.platform !== "win32" }, async () => {
  const d = mkdtempSync(join(tmpdir(), "dg spaced "));
  const bin = join(d, "my tools");
  mkdirSync(bin);
  const shim = join(bin, "mock server.cmd");
  const mock = fileURLToPath(new URL("./mock-server.js", import.meta.url));
  writeFileSync(shim, `@"${process.execPath}" "${mock}" %*\r\n`);
  writeFileSync(join(d, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: shim, args: [] } } }));
  const r = await run({ publicFeed: false, timeoutMs: 10000, mode: "lock", cwd: d, env: { ...process.env } });
  const local = r.results.find((x) => x.name === "local");
  assert.equal(local.status, "locked", local.error);
});

// npx.cmd finds npm through %~dp0. Started by a QUOTED bare name, cmd resolves %~dp0 to
// the current directory instead ("Cannot find module ...\node_modules\npm\bin\npx-cli.js").
// This shim fails the same way, offline.
test("Windows: a bare-name shim on PATH that uses %~dp0 is probed", { skip: process.platform !== "win32" }, async () => {
  const d = mkdtempSync(join(tmpdir(), "dg-path-"));
  const bin = join(d, "bin");
  mkdirSync(bin);
  const mock = fileURLToPath(new URL("./mock-server.js", import.meta.url));
  writeFileSync(join(bin, "mock-server.js"), `import(${JSON.stringify(new URL("./mock-server.js", import.meta.url).href)});\n`);
  writeFileSync(join(bin, "dgmockshim.cmd"), `@"${process.execPath}" "%~dp0mock-server.js" %*\r\n`);
  const work = join(d, "repo");
  mkdirSync(work);
  writeFileSync(join(work, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: "dgmockshim", args: [] } } }));
  const saved = process.env.PATH;
  process.env.PATH = `${bin};${saved}`;
  let r;
  try { r = await run({ publicFeed: false, timeoutMs: 10000, mode: "lock", cwd: work, env: { ...process.env } }); }
  finally { process.env.PATH = saved; }
  const local = r.results.find((x) => x.name === "local");
  assert.ok(mock);
  assert.equal(local.status, "locked", local.error);
});
