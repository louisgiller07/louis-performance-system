import { athleteSafeMonitoring } from "./safetyPresentation";
import { retainedSignals, SIGNAL_CHECKIN_FIELD, type CheckinField } from "./coachInsights";
import type { DailyPlan } from "./dailyPlanTypes";
import type { CheckinRow } from "../checkin/checkinTypes";

// UX-04 / UX-05 — Today's "Ce que ton coach a retenu" + "Ton état du jour" cards (replaces
// the Readiness card on Today only; History keeps ReadinessCard).
// - Retained signals come only from the engine's own `signals_used`
//   (coachInsights.ts), worded for a rider.
// - The state tiles show the athlete's own check-in answers as they were
//   declared — values, never a judgment. A tile is accented only when the
//   engine retained a signal coming from that answer.
// - The server-derived health signal and the first monitoring note keep
//   exactly the ReadinessCard semantics (red when active, sanitized text).
interface Tile {
  field: CheckinField;
  label: string;
  value: string;
  detail?: string;
}

function tilesFrom(checkin: CheckinRow): Tile[] {
  const tiles: Tile[] = [];
  if (checkin.sleep_hours !== null) {
    const hours = `${String(checkin.sleep_hours).replace(".", ",")} h`;
    tiles.push({ field: "sleep", label: "Sommeil", value: hours, detail: checkin.sleep_quality !== null ? `qualité ${checkin.sleep_quality}/10` : undefined });
  }
  if (checkin.energy !== null) tiles.push({ field: "energy", label: "Énergie", value: `${checkin.energy}/10` });
  if (checkin.leg_fatigue !== null) tiles.push({ field: "leg_fatigue", label: "Fatigue jambes", value: `${checkin.leg_fatigue}/10` });
  if (checkin.grip_fatigue !== null) tiles.push({ field: "grip_fatigue", label: "Avant-bras", value: `${checkin.grip_fatigue}/10` });
  return tiles;
}

export function CoachStateCard({
  dailyPlan,
  hasHealthSignal,
  checkin,
  revealed = false,
}: {
  dailyPlan: DailyPlan;
  hasHealthSignal: boolean;
  checkin: CheckinRow | null;
  /** True right after a fresh analysis: the retained signals arrive one by one. */
  revealed?: boolean;
}) {
  const signals = retainedSignals(dailyPlan);
  const retainedFields = new Set(signals.map((entry) => SIGNAL_CHECKIN_FIELD[entry.signal]).filter(Boolean));
  const tiles = checkin ? tilesFrom(checkin) : [];
  const attention = athleteSafeMonitoring(dailyPlan)[0];
  const baseDelay = revealed ? 900 : 120;

  // UX-05 — two distinct cards, in the validated order: what the coach retained, then the athlete's state.
  return (
    <>
      <section aria-labelledby="coach-state-title" className={`rounded-xl border border-line bg-card p-5 ${revealed ? "coach-revealed" : ""}`}>
        <h2 id="coach-state-title" className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          Ce que ton coach a retenu
        </h2>

        {signals.length > 0 ? (
          <ul className="mt-4 flex flex-col">
            {signals.map((entry, index) => (
              <li
                key={entry.label}
                className="ux-enter flex items-center gap-3 border-b border-line py-3 first:pt-0 last:border-b-0"
                style={{ ["--d" as string]: `${baseDelay + index * 180}ms` }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <span className="font-display text-2xl font-extrabold uppercase leading-none text-ink">{entry.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ux-enter mt-3 text-sm leading-relaxed text-ink/80" style={{ ["--d" as string]: `${baseDelay}ms` }}>
            Aucun signal de ton check-in n'a demandé d'adapter ta séance.
          </p>
        )}
      </section>

      <section aria-labelledby="day-state-title" className="rounded-xl border border-line bg-card p-5">
        <h2 id="day-state-title" className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          Ton état du jour
        </h2>
        {tiles.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-2">
            {tiles.map((tile, index) => {
              const retained = retainedFields.has(tile.field);
              return (
                <div
                  key={tile.field}
                  className={`ux-enter rounded-lg border p-3 ${retained ? "border-gold/60 bg-gold/6" : "border-line"}`}
                  style={{ ["--d" as string]: `${baseDelay + (signals.length + index) * 120}ms` }}
                >
                  <dt className="text-[0.68rem] uppercase tracking-[0.16em] text-muted">{tile.label}</dt>
                  <dd className={`mt-1 font-display text-3xl font-extrabold leading-none ${retained ? "text-gold" : "text-ink"}`}>{tile.value}</dd>
                  {tile.detail && <dd className="mt-1 text-xs text-muted">{tile.detail}</dd>}
                </div>
              );
            })}
          </dl>
        )}

        <div className={`flex items-center justify-between gap-3 ${tiles.length > 0 ? "mt-4 border-t border-line pt-3" : "mt-3"}`}>
          <p className="text-[0.68rem] uppercase tracking-[0.16em] text-muted">État du corps</p>
          <p className={`font-display text-lg font-extrabold uppercase leading-none ${hasHealthSignal ? "text-red-400" : "text-gold"}`}>
            {hasHealthSignal ? "Signal actif" : "Prêt"}
          </p>
        </div>
        {attention && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[0.68rem] uppercase tracking-[0.16em] text-muted">Attention</p>
            <p className="mt-1 text-sm text-ink/90">{attention}</p>
          </div>
        )}
      </section>
    </>
  );
}
