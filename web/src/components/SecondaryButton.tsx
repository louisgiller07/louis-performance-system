import type { ButtonHTMLAttributes } from "react";

// V0.3 UX PREMIUM — Global App Redesign. The one shared secondary action
// button (outlined, muted) — generalizes the pattern already used by
// "Réessayer"/"Modifier"/"Annuler" across the app.
export function SecondaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded border border-white/10 px-4 py-2 text-sm font-medium text-ink/80 disabled:opacity-40 ${className}`}
    />
  );
}
