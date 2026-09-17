import type { ReactNode } from "react";

type BadgeTone = "gold" | "muted" | "red" | "green";

const TONE_CLASS: Record<BadgeTone, string> = {
  gold: "bg-gold/15 text-gold",
  muted: "bg-white/5 text-ink/80",
  red: "bg-red-500/15 text-red-400",
  green: "bg-emerald-500/15 text-emerald-400",
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
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
