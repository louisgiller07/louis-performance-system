import type { ReactNode } from "react";

type BadgeTone = "gold" | "muted" | "red" | "green";

// UX-01 — hairline outline tags instead of filled pills. `green` is kept as
// a tone NAME for existing call sites (a genuinely completed/"done"
// outcome) but no longer renders green: off-palette colors are reserved for
// safety (red) and race/health (amber). It reads as a quiet "done" state.
const TONE_CLASS: Record<BadgeTone, string> = {
  gold: "border-gold/50 text-gold",
  muted: "border-line text-ink/75",
  red: "border-red-500/50 text-red-400",
  green: "border-ink/25 text-ink",
};

interface BadgeProps {
  children: ReactNode;
  /**
   * gold = positive/performance (séance réussie, résultat positif) — muted
   * = neutral information — red = a real problem only. green is a
   * deliberate, narrow exception (History V0.3 UX PREMIUM) reserved
   * EXCLUSIVELY for a genuinely completed/"done" outcome badge — never a
   * general-purpose success color, never used for a decision/safety
   * signal (KEEP/MODIFY/REPLACE stay gold-family, REST/SAFETY stays red —
   * see DecisionHero.tsx). Same vocabulary as the rest of the redesign;
   * never a fifth ad hoc color introduced at a call site.
   */
  tone?: BadgeTone;
}

// V0.3 UX PREMIUM — Global App Redesign. The one shared small status pill —
// generalizes the badge markup already used inline for Session Plan's
// duration/load chips (DailyPlanView.tsx) so future call sites (History's
// day cards, Insights) don't reinvent it.
export function Badge({ children, tone = "muted" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
