import type { ButtonHTMLAttributes } from "react";

// V0.3 UX PREMIUM — Global App Redesign. The one shared primary action
// button (solid gold, dark text) — generalizes the pattern already used by
// "Générer mon plan"/"Enregistrer le check-in"/"Enregistrer la séance".
// A plain <button type="button"> passthrough for props (onClick, disabled,
// type override, aria-*) — no custom behavior, styling only.
export function PrimaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded bg-gold px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40 ${className}`}
    />
  );
}
