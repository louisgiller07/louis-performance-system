import type { RaceHorizon } from "./todayContext";

// UX-04 — "Bonjour Louis", the date, and the one thing the athlete is working
// towards: the next race (J-XX under 120 days, "Prochain objectif" up to a
// year) or, without one, their stated objective.
function raceHorizonLine(horizon: RaceHorizon): { label: string; value: string } {
  if (horizon.kind === "ongoing") return { label: `Course en cours · jour ${horizon.day}`, value: horizon.race.eventName };
  if (horizon.kind === "countdown") return { label: horizon.days === 1 ? "Demain" : `J-${horizon.days}`, value: horizon.race.eventName };
  return { label: "Prochain objectif", value: horizon.race.eventName };
}

export function TodayGreeting({
  firstName,
  friendlyDate,
  canonicalDate,
  horizon,
  objective,
}: {
  firstName: string | null;
  friendlyDate: string;
  canonicalDate: string;
  horizon: RaceHorizon | null;
  objective: string | null;
}) {
  const target = horizon ? raceHorizonLine(horizon) : objective ? { label: "Objectif actuel", value: objective } : null;

  return (
    <section aria-label="Ta journée" className="ux-enter pt-1">
      <h1 className="font-display text-[clamp(2.5rem,11vw,3.25rem)] font-extrabold uppercase leading-[0.95] text-ink">
        {firstName ? `Bonjour ${firstName}` : "NALYNT"}
      </h1>
      <p className="mt-1.5 text-base text-muted">
        <time dateTime={canonicalDate}>{friendlyDate}</time>
      </p>
      {target && (
        <p className="ux-enter mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-gold pl-3" style={{ ["--d" as string]: "120ms" }}>
          <span className="font-display text-xl font-extrabold uppercase leading-none text-gold">{target.label}</span>
          <span className="text-sm font-medium text-ink">{target.value}</span>
        </p>
      )}
    </section>
  );
}
