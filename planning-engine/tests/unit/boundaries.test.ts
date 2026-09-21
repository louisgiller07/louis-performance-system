/**
 * M1 architecture boundary — mirrors longitudinal-engine/tests/unit/
 * boundaries.test.ts's exact approach and adapts it to M1's stricter
 * constraint (this package has no I/O at all yet, not just read-only I/O).
 */
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../../package.json", import.meta.url));

function allSourceFiles(): string[] {
  return globSync("**/*.ts", { cwd: SRC_DIR }).map((f) => `${SRC_DIR}/${f}`);
}

/** Strips block/line comments so prose mentions in doc comments (this file's own JSDoc explains the boundary in words) never get flagged as if they were code. */
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

describe("M1 architecture boundary — planning-engine never imports head-coach-engine internals", () => {
  it("contains zero import/require specifiers pointing at head-coach-engine across src/**", () => {
    expect(findOffenders(/(?:from\s+["']|require\(\s*["'])[^"']*head-coach-engine/)).toEqual([]);
  });
});

describe("M1 architecture boundary — planning-engine never imports web/React code", () => {
  it("contains zero import/require specifiers pointing at web or react across src/**", () => {
    expect(findOffenders(/(?:from\s+["']|require\(\s*["'])[^"']*(?:\/web\/|^react$|["']react["'])/)).toEqual([]);
  });
});

describe("M1 architecture boundary — planning-engine has no Supabase dependency", () => {
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

describe("M1 architecture boundary — no I/O primitives in src/**", () => {
  it("contains no fetch/fs/http/net usage outside of comments", () => {
    const forbidden = [
      "fetch(",
      "require(\"node:fs\")",
      "require('node:fs')",
      "from \"node:fs\"",
      "from 'node:fs'",
      "require(\"node:http\")",
      "require(\"node:net\")",
      "from \"node:http\"",
      "from \"node:net\"",
      "XMLHttpRequest",
    ];
    const offenders: { file: string; token: string }[] = [];
    for (const file of allSourceFiles()) {
      const code = stripComments(readFileSync(file, "utf-8"));
      for (const token of forbidden) {
        if (code.includes(token)) offenders.push({ file, token });
      }
    }
    expect(offenders).toEqual([]);
  });
});
