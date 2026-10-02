// Test-only: the guided-session integration suites call the REAL local
// `session-execution` Edge Function. They never start a runtime themselves;
// they check it first and fail loudly with the fix, instead of failing later
// on a confusing 503 (e.g. after another harness stopped the runtime).

/** Requires 3 consecutive non-gateway answers (an unauthenticated POST answers 401 when the function serves). */
export async function assertSessionExecutionServing(supabaseUrl: string, timeoutMs = 30_000): Promise<void> {
  const url = `${supabaseUrl}/functions/v1/session-execution`;
  const start = Date.now();
  let consecutive = 0;
  let last: number | string = "no answer";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      last = res.status;
      consecutive = [502, 503, 504].includes(res.status) ? 0 : consecutive + 1;
      if (consecutive >= 3) return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      consecutive = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Local Edge runtime is not serving session-execution (last answer: ${last}). Start it from the repository root: \`npx supabase functions serve\`. ` +
      "Note: test:m3:http and test:m5:completed-session:http stop the runtime when they exit."
  );
}
