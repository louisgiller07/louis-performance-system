import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

// V0.3 UX PREMIUM — Global App Redesign. The one shared "premium card" shell
// (dark card, subtle border, rounded-xl, generous padding) — the same visual
// language already established by TodayPage's sections. `className` is an
// escape hatch for a rare one-off adjustment (e.g. extra padding), never a
// way to override the core dark-card identity.
export function Card({ children, className = "" }: CardProps) {
  return <div className={`rounded-xl border border-white/5 bg-card p-4 ${className}`}>{children}</div>;
}
