import { Link } from "react-router-dom";

// UX-02 — the quiet in-page link to a secondary screen that no longer has
// its own tab (Programme → Modifier ma semaine, Historique → Insights, and the way
// back). One hairline row, arrow on the side it leads to.
export function SubPageLink({ to, label, hint, back = false }: { to: string; label: string; hint?: string; back?: boolean }) {
  return (
    <Link
      to={to}
      aria-label={back ? `Retour à ${label}` : undefined}
      className="ux-press group flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink hover:border-gold/50"
    >
      <span className="flex items-center gap-3">
        {back && (
          <span className="text-gold transition-transform duration-300 group-hover:-translate-x-0.5" aria-hidden="true">
            ←
          </span>
        )}
        <span className="font-medium">{label}</span>
        {hint && <span className="text-muted">{hint}</span>}
      </span>
      {!back && (
        <span className="text-gold transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true">
          →
        </span>
      )}
    </Link>
  );
}
