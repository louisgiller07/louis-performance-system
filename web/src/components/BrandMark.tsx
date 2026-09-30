// UX-10A — the NALYNT mark of the entry screens (login, signup, password,
// loading), in the site's identity: Barlow wordmark, and the promise when
// there is room for it.
export function BrandMark({ promise = false, size = "lg" }: { promise?: boolean; size?: "lg" | "md" }) {
  return (
    <div className="flex flex-col items-center text-center">
      <p className={`font-display font-extrabold uppercase text-ink ${size === "lg" ? "text-4xl tracking-[0.32em]" : "text-2xl tracking-[0.28em]"}`}>Nalynt</p>
      {promise && (
        <p className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight text-ink">
          Ton objectif reste.
          <br />
          <span className="text-gold">Ton plan s'adapte.</span>
        </p>
      )}
    </div>
  );
}
