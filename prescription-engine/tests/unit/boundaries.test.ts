/**
 * prescription-engine architecture boundary — mirrors planning-engine's own
 * tests/unit/boundaries.test.ts approach exactly (V0.4_131).
 */
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../../package.json", import.meta.url));

function allSourceFiles(): string[] {
  return globSync("**/*.ts", { cwd: SRC_DIR }).map((f) => `${SRC_DIR}/${f}`);
}

/** Strips block/line comments so prose mentions in doc comments never get flagged as if they were code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function findOffenders(pattern: RegExp): string[] {
  const offenders: string[] = [];
  for (const file of allSourceFiles()) {
    const code = stripComments(readFileSync(file, "utf-8"));
    if (pattern.test(code)) offenders.push(file);
  }
  return offenders;
}

describe("prescription-engine architecture boundary — never imports head-coach-engine internals", () => {
  it("contains zero import/require specifiers pointing at head-coach-engine across src/**", () => {
    expect(findOffenders(/(?:from\s+["']|require\(\s*["'])[^"']*head-coach-engine/)).toEqual([]);
  });
});

describe("prescription-engine architecture boundary — never imports web/React code", () => {
  it("contains zero import/require specifiers pointing at web or react across src/**", () => {
    expect(findOffenders(/(?:from\s+["']|require\(\s*["'])[^"']*(?:\/web\/|^react$|["']react["'])/)).toEqual([]);
  });
});

describe("prescription-engine architecture boundary — no Supabase dependency", () => {
  it("does not import @supabase/supabase-js anywhere in src/**", () => {
    expect(findOffenders(/(?:from\s+["']|require\(\s*["'])@supabase\/supabase-js/)).toEqual([]);
  });

  it("package.json declares no @supabase/supabase-js dependency — structurally, not just by convention", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@supabase/supabase-js"]).toBeUndefined();
    expect(pkg.devDependencies?.["@supabase/supabase-js"]).toBeUndefined();
  });
});

describe("prescription-engine architecture boundary — depends on planning-engine by design", () => {
  it("package.json declares planning-engine as a dependency", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["planning-engine"]).toBeDefined();
  });
});
