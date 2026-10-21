// SPORT-SAFE-02 (HPM 2026-10-21) — the rider's own stop rule for a DH session: hands or forearms too tired to hold
// the bar or brake reliably → stop. A fixed instruction shown with today's DH session (Today, guided DH session),
// never a detection of the rider's state, never a threshold, never a dose change. Not part of the persisted
// DailyPlan: History never shows it on a past day (docs/03, invariant d'historique).
export const DH_GRIP_SAFETY_TEXT =
  "Si la fatigue des mains ou des avant-bras t'empêche de tenir correctement le guidon ou de freiner de façon fiable, arrête ta séance DH. Ne poursuis pas une descente lorsque tu n'as plus le contrôle nécessaire.";

export function DhGripSafetyNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-lg border border-amber-400/40 bg-amber-950/20 p-3 ${className}`} data-testid="dh-grip-safety">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Sécurité</p>
      <p className="mt-1 text-sm text-ink/80">{DH_GRIP_SAFETY_TEXT}</p>
    </div>
  );
}
