import { useState } from "react";
import { ALLOWED_REVIEW_DECISIONS } from "./insightsValidation";
import { RESPONSE, RESPONSES } from "./insightsPresentation";
import type { PatternInsightReviewDecision } from "./insightsTypes";

const MAX_NOTE_LENGTH = 2000;

interface ReviewControlsProps {
  candidateKey: string;
  disabled: boolean;
  onReview: (decision: PatternInsightReviewDecision, reviewerNote: string | null) => void;
}

// Exactly the three locked human decisions — no fourth action, no automatic
// selection — worded for a rider (UX-10B-2A: "Ça me parle / Pas vraiment /
// Pas encore sûr", same values sent). A response is feedback only: it
// changes no plan, and the controls say so. `disabled` covers both "a submit
// for THIS candidate is already in flight" and "this card's candidate just
// went stale/vanished" (the parent decides when to pass true).
export function ReviewControls({ candidateKey, disabled, onReview }: ReviewControlsProps) {
  const [note, setNote] = useState("");

  // Whitespace-only input is never silently submitted as a reviewerNote —
  // it normalizes to null, matching the backend's own reviewerNote contract.
  function normalizedNote(): string | null {
    const trimmed = note.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  function handleClick(decision: PatternInsightReviewDecision) {
    if (disabled) return;
    onReview(decision, normalizedNote());
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <p className="text-sm font-medium text-ink">{RESPONSE.question}</p>
      <div role="group" aria-label={RESPONSE.question} className="grid grid-cols-3 gap-2">
        {ALLOWED_REVIEW_DECISIONS.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={disabled}
            onClick={() => handleClick(decision)}
            className="ux-press min-h-12 rounded-lg border border-line px-2 py-2 text-sm font-medium text-ink/85 hover:border-gold/60 disabled:opacity-40"
          >
            {RESPONSES[decision]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{RESPONSE.keep}</p>
      <label className="flex flex-col gap-1.5 text-sm text-ink/80" htmlFor={`reviewer-note-${candidateKey}`}>
        {RESPONSE.noteLabel}
        <textarea
          id={`reviewer-note-${candidateKey}`}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_LENGTH))}
          disabled={disabled}
          rows={2}
          maxLength={MAX_NOTE_LENGTH}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-base text-ink disabled:opacity-50"
        />
        <span className="text-xs text-muted">{RESPONSE.noteHint}</span>
      </label>
    </div>
  );
}
