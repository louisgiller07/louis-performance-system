// Non-destructive build of dist/ (harness safety).
//
// `supabase functions serve` watches the files the Edge Functions import
// from head-coach-engine/dist and restarts the runtime on every write. The
// former build rewrote every file of dist/ even when nothing changed, and a
// restart in the middle of that burst could leave the runtime dead
// ("worker boot error: could not find an appropriate entrypoint"), taking
// the local functions down for every later suite.
//
// Now each step builds into a staging directory, then copies into dist/ ONLY
// the files whose content changed, each one atomically (temporary file +
// rename): an unchanged rebuild writes nothing, a real change writes only the
// changed files and never a half-written one. Output layout and content are
// identical to before.
//
//   node scripts/build.mjs        → tsc -p tsconfig.build.json (was `npm run build`)
//   node scripts/build.mjs --edge → the two esbuild Edge bundles (was `npm run build:edge`)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const edge = process.argv.includes("--edge");
const STAGING = join(ROOT, edge ? ".build-staging-edge" : ".build-staging");

function run(command, args) {
  // One command string (paths quoted, no user input): npx is a shell shim on Windows.
  const line = [command, ...args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" ");
  const r = spawnSync(line, { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Copies every staged file into dist/ when (and only when) its content differs; atomic per file. */
export function syncChanged(from, to) {
  let written = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const source = join(dir, name);
      const target = join(to, relative(from, source));
      if (statSync(source).isDirectory()) {
        walk(source);
        continue;
      }
      const next = readFileSync(source);
      if (existsSync(target) && readFileSync(target).equals(next)) continue;
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      copyFileSync(source, temporary);
      renameSync(temporary, target);
      written += 1;
    }
  };
  walk(from);
  return written;
}

rmSync(STAGING, { recursive: true, force: true });
if (edge) {
  for (const [entry, bundle] of [
    ["generateTrainingPlanEdgeEntry.js", "generateTrainingPlan.bundle.js"],
    ["dailyRunV2EdgeEntry.js", "dailyRunV2.bundle.js"],
  ]) {
    run("npx", ["esbuild", join("dist", "edge", entry), "--bundle", "--format=esm", "--platform=neutral", "--external:node:*", `--outfile=${join(STAGING, "edge", bundle)}`]);
  }
  copyFileSync(join(DIST, "edge", "dailyRunV2EdgeEntry.d.ts"), join(STAGING, "edge", "dailyRunV2.bundle.d.ts"));
} else {
  run("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", STAGING]);
}
const written = syncChanged(STAGING, DIST);
rmSync(STAGING, { recursive: true, force: true });
console.log(`dist: ${written} file(s) written${written === 0 ? " (unchanged, nothing rewritten)" : ""}`);
