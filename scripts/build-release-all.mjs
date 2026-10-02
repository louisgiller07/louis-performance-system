// UX-11R.3 — one offline release build for everything a deployment reads.
//
//   npm run build:release:all            (from the repository root)
//   npm run build:release:all -- --verify-only
//                                        (no build: only steps 4 and 5, e.g. just before a deploy)
//
// Prerequisite (the only step that uses the network, the npm registry):
// `npm ci` at the root and in planning-engine, prescription-engine,
// longitudinal-engine, head-coach-engine and web. This script never
// installs, never contacts Supabase, Vercel or any other service, and
// deploys nothing.
//
// Order (each step fails the whole build):
//   1. head-coach-engine `build:release`: planning-engine, then
//      prescription-engine (depends on it), then head-coach-engine dist and
//      the two Edge bundles.
//   2. longitudinal-engine build (get-insights, refresh-longitudinal and
//      submit-review import its dist; `functions serve` loads every function).
//   3. web production build (the same `npm run build` Vercel runs on web/).
//   4. Edge import graph check: from every supabase/functions/*/index.ts,
//      every relative import must resolve to a file on disk, and every bare
//      specifier must be mapped by the function's deno.json (or be a known,
//      documented exception). A missing dist file fails the build here.
//   5. Inventory: sha256 of each Edge bundle and of each function's whole
//      import graph, for the release record.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["planning-engine", "prescription-engine", "longitudinal-engine", "head-coach-engine", "web"];
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
// Bare specifiers that may appear in a function's graph without a deno.json mapping.
const KNOWN_UNMAPPED = new Map([
  // runDailyFor.js keeps a lazy Node-only import; daily-run injects dailyRunV2.bundle.js instead
  // and never executes it (UX-11R.1 §6). The eszip bundler reports it as unmapped without failing.
  ["planning-engine/session-model-v2/daily", "daily-run"],
]);

function fail(message) {
  console.error(`\nbuild:release:all FAILED — ${message}`);
  process.exit(1);
}

function run(cwd, script) {
  console.log(`\n▶ ${relative(ROOT, cwd) || "."}: npm run ${script}`);
  const r = spawnSync(`npm run ${script}`, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`${relative(ROOT, cwd)}: npm run ${script} exited with ${r.status}`);
}

for (const pkg of PACKAGES) {
  if (!existsSync(join(ROOT, pkg, "node_modules"))) fail(`${pkg}/node_modules is missing: run \`npm ci\` in ${pkg} first`);
}

if (!process.argv.includes("--verify-only")) {
  run(join(ROOT, "head-coach-engine"), "build:release");
  run(join(ROOT, "longitudinal-engine"), "build");
  run(join(ROOT, "web"), "build");
}

const IMPORT_RE = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const rel = (file) => relative(ROOT, file).replace(/\\/g, "/");

const problems = [];
const inventory = [];
for (const name of readdirSync(FUNCTIONS_DIR).sort()) {
  const entry = join(FUNCTIONS_DIR, name, "index.ts");
  if (!existsSync(entry)) continue;
  const denoJson = join(FUNCTIONS_DIR, name, "deno.json");
  const mapped = existsSync(denoJson) ? Object.keys(JSON.parse(readFileSync(denoJson, "utf8")).imports ?? {}) : [];
  const seen = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".bundle.js")) continue; // self-contained esbuild output
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec);
        if (existsSync(target)) stack.push(target);
        else problems.push(`${name}: ${rel(file)} imports missing ${rel(target)}`);
      } else if (!(spec.startsWith("npm:") || spec.startsWith("jsr:") || mapped.includes(spec) || KNOWN_UNMAPPED.get(spec) === name)) {
        problems.push(`${name}: unmapped bare specifier "${spec}" in ${rel(file)}`);
      }
    }
  }
  const files = [...seen].sort();
  const graph = createHash("sha256");
  for (const file of files) graph.update(`${rel(file)}\0${sha256(file)}\n`);
  inventory.push({
    name,
    files: files.length,
    graphSha256: graph.digest("hex"),
    bundles: files.filter((f) => f.endsWith(".bundle.js")).map((f) => `${rel(f)} ${sha256(f)}`),
  });
}
if (problems.length > 0) fail(`Edge import graph:\n  ${problems.join("\n  ")}`);

console.log("\nEdge inventory (sha256):");
for (const item of inventory) {
  console.log(`  ${item.name}: ${item.files} files, graph ${item.graphSha256}`);
  for (const bundle of item.bundles) console.log(`    bundle ${bundle}`);
}
console.log("\nbuild:release:all OK — nothing deployed, no remote service contacted.");
