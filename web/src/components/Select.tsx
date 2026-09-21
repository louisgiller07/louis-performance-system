import type { SelectHTMLAttributes } from "react";

// V0.3 — the one shared <select> primitive. Centralizes the container
// styling every select in the app already used (near-)identically; the
// actual Chrome/Edge dropdown-popup readability fix lives in index.css
// (`select option, select optgroup`), which applies globally regardless of
// which component renders the <select> — this wrapper is about a
// consistent pattern, not the fix itself. Children (<option>/<optgroup>)
// are passed through untouched — this never abstracts over option data.
export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded border border-white/10 bg-transparent px-3 py-3 text-base text-ink disabled:bg-white/5 disabled:text-muted ${className}`}
    />
  );
}
