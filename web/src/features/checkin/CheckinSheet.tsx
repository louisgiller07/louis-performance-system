import { useEffect, useRef, type ReactNode } from "react";

// UX-03 — the full-screen "ritual" layer the guided check-in runs in. It
// stays mounted while closed (just hidden) so the CheckinForm inside keeps
// loading today's check-in on page load and reporting whether one exists —
// Today needs that signal before the athlete ever opens the sheet.
export function CheckinSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Check-in du jour" hidden={!open} className="checkin-sheet fixed inset-0 z-50 overflow-y-auto bg-bg">
      <div className="checkin-sheet-panel mx-auto flex min-h-full max-w-md flex-col px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="flex min-h-12 items-center justify-between">
          <span className="font-display text-lg font-extrabold uppercase tracking-[0.28em] text-ink">Check-in</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer le check-in"
            className="ux-press flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink/80 hover:border-gold/60 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="mt-4 flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
