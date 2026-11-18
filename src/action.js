// GitHub Action entry point. No @actions/* dependency: inputs, outputs and summary via the documented env files.
import { appendFileSync } from "node:fs";
import { report, run } from "./run.js";

const input = (name, def = "") => {
  const v = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
  return v === undefined || v === "" ? def : v.trim();
};
const bool = (name, def) => !/^(false|0|no|off)$/i.test(input(name, String(def)));
const output = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__DG__\n${v}\n__DG__\n`);
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

async function main() {
  const mode = input("mode", "check");
  const lockfile = input("lockfile", "mcp-tools.lock.json");
  const failOn = input("fail-on", "any");
  const configs = input("config").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const r = await run({
    mode, lockfile, configs: configs.length ? configs : undefined,
    cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
    stdio: bool("stdio", true), timeoutMs: Number(input("timeout-ms", "30000")),
    publicFeed: bool("public-feed", true), readerCard: input("reader-card") || undefined,
  });
  const md = report(r);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  output("drift", String(!!r.drift));
  output("signals", (r.signals ?? []).join("\n"));
  output("report", md);
  output("json", JSON.stringify(r));
  if (r.error) { console.log(`::error::${esc(r.error)}`); process.exit(1); }
  for (const x of r.results.filter((y) => ["drifted", "unlocked"].includes(y.status)))
    console.log(`::${failOn === "never" ? "warning" : "error"} file=${lockfile},title=MCP tool drift: ${x.name}::${esc(x.status === "unlocked" ? "server is not in the lockfile" : [...x.added.map((t) => `added ${t.name}`), ...x.removed.map((t) => `removed ${t.name}`), ...x.changedTools.map((t) => `changed ${t.name} (${t.fields.join(", ")})`)].join("; "))}`);
  for (const x of r.results.filter((y) => ["unreachable", "auth_required"].includes(y.status)))
    console.log(`::warning title=MCP server not checked: ${x.name}::${esc(x.error ?? x.status)}`);
  const fail = failOn === "never" ? false : failOn === "signals" ? r.signals.length > 0 : mode === "check" && r.drift;
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.log(`::error::${esc(e.stack ?? e)}`); process.exit(1); });
