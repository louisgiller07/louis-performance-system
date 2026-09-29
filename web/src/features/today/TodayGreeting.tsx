// UX-04 — "Bonjour Louis" and the date. UX-05 moved the race / objective into
// its own context banner (RaceBanner.tsx), right below. Without a usable
// name: "Bonjour" alone — NALYNT is the brand, not the rider's identity.
export function TodayGreeting({ firstName, friendlyDate, canonicalDate }: { firstName: string | null; friendlyDate: string; canonicalDate: string }) {
  return (
    <section aria-label="Ta journée" className="ux-enter pt-1">
      <h1 className="font-display text-[clamp(2.5rem,11vw,3.25rem)] font-extrabold uppercase leading-[0.95] text-ink">
        {firstName ? `Bonjour ${firstName}` : "Bonjour"}
      </h1>
      <p className="mt-1.5 text-base text-muted">
        <time dateTime={canonicalDate}>{friendlyDate}</time>
      </p>
    </section>
  );
}
