import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

function allSourceFiles(): string[] {
  return globSync("**/*.ts", { cwd: SRC_DIR }).map((f) => `${SRC_DIR}/${f}`);
}

/** Strips /** *\/ block comments and // line comments so prose mentions (this file's own JSDoc explains the boundary in words) don't get flagged as if they were code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("M5 architecture boundary — longitudinal-engine never imports head-coach-engine", () => {
  it("contains zero import/require specifiers pointing at head-coach-engine across src/**", () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      const code = stripComments(readFileSync(file, "utf-8"));
      if (/(?:from\s+["']|require\(\s*["'])[^"']*head-coach-engine/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("read-only invariant — the Supabase adapter never writes", () => {
  it("adapter.ts contains no insert/update/upsert/delete/rpc call outside of comments", () => {
    const code = stripComments(readFileSync(`${SRC_DIR}/supabase/adapter.ts`, "utf-8"));
    const forbidden = [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("];
    const found = forbidden.filter((token) => code.includes(token));
    expect(found).toEqual([]);
  });
});
