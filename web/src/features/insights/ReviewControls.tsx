import { useState } from "react";
import { ALLOWED_REVIEW_DECISIONS } from "./insightsValidation";
import { REVIEW_DECISION_LABELS } from "./insightsLabels";
import type { PatternInsightReviewDecision } from "./insightsTypes";

const MAX_NOTE_LENGTH = 2000;

interface ReviewControlsProps {
  candidateKey: string;
  disabled: boolean;
  onReview: (decision: PatternInsightReviewDecision, reviewerNote: string | null) => void;
}

// Exactly the three locked human decisions — no fourth action, no automatic
// selection. `disabled` covers both "a submit for THIS candidate is already
// in flight" and "this card's candidate just went stale/vanished" (the
// parent decides when to pass true) — mirrors CompletedSessionCard's
// disabled-while-saving convention.
export function ReviewControls({ candidateKey, disabled, onReview }: ReviewControlsProps) {
  const [note, setNote] = useState("");

  // Whitespace-only input is never silently submitted as a reviewerNote —
  // it normalizes to null, matching the backend's own reviewerNote
  // contract (never blank/whitespace-only, always already trimmed).
  function normalizedNote(): string | null {
    const trimmed = note.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  function handleClick(decision: PatternInsightReviewDecision) {
    if (disabled) return;
    onReview(decision, normalizedNote());
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm text-gray-700" htmlFor={`reviewer-note-${candidateKey}`}>
        Note (optionnelle)
        <textarea
          id={`reviewer-note-${candidateKey}`}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_LENGTH))}
          disabled={disabled}
          rows={2}
          maxLength={MAX_NOTE_LENGTH}
          className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {ALLOWED_REVIEW_DECISIONS.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={disabled}
            onClick={() => handleClick(decision)}
            className="min-h-11 flex-1 rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 active:bg-gray-100 disabled:opacity-50"
          >
            {REVIEW_DECISION_LABELS[decision]}
          </button>
        ))}
      </div>
    </div>
  );
}
