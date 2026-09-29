import type { ButtonHTMLAttributes } from "react";

// V0.3 UX PREMIUM — Global App Redesign. The one shared secondary action
// button (outlined, muted) — generalizes the pattern already used by
// "Réessayer"/"Modifier"/"Annuler" across the app.
export function SecondaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`ux-press min-h-11 rounded border border-line px-4 py-2 text-sm font-medium text-ink/85 hover:border-gold/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light disabled:opacity-40 ${className}`}
    />
  );
}
