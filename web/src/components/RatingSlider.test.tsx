import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatingSlider } from "./RatingSlider";

// NAL-004 — endpoint labels are purely descriptive text; they must never
// change the numeric contract (min/max/step/value) submitted by the slider.
describe("RatingSlider", () => {
  it("A: renders the low-end endpoint label when provided", () => {
    render(<RatingSlider label="Énergie" value={5} onChange={vi.fn()} lowLabel="Épuisé" highLabel="Plein d'énergie" />);
    expect(screen.getByText(/Épuisé/)).toBeInTheDocument();
  });

  it("B: renders the high-end endpoint label when provided", () => {
    render(<RatingSlider label="Énergie" value={5} onChange={vi.fn()} lowLabel="Épuisé" highLabel="Plein d'énergie" />);
    expect(screen.getByText(/Plein d'énergie/)).toBeInTheDocument();
  });

  it("renders no endpoint-label row at all when neither is provided (no visual regression for a bare slider)", () => {
    render(<RatingSlider label="Énergie" value={5} onChange={vi.fn()} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("C: selecting the minimum (0) reports exactly 0 — never remapped/inverted", () => {
    const onChange = vi.fn();
    render(<RatingSlider label="Énergie" value={5} onChange={onChange} lowLabel="Épuisé" highLabel="Plein d'énergie" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("D: selecting the maximum (10) reports exactly 10 — never remapped/inverted", () => {
    const onChange = vi.fn();
    render(<RatingSlider label="Énergie" value={5} onChange={onChange} lowLabel="Épuisé" highLabel="Plein d'énergie" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("E: an intermediate value is reported unchanged", () => {
    const onChange = vi.fn();
    render(<RatingSlider label="Énergie" value={5} onChange={onChange} lowLabel="Épuisé" highLabel="Plein d'énergie" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("min/max/step are unchanged by endpoint labels — the numeric contract is untouched", () => {
    render(<RatingSlider label="Énergie" value={5} onChange={vi.fn()} lowLabel="Épuisé" highLabel="Plein d'énergie" />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("10");
    expect(slider.step).toBe("1");
  });

  it("endpoint label text is inside the accessible label — readable by assistive tech, not color/position-only", () => {
    render(<RatingSlider label="Jambes" value={5} onChange={vi.fn()} lowLabel="Fraîches" highLabel="Très lourdes" />);
    // The slider's accessible name is computed from the full wrapping
    // <label> text content — this proves the endpoint semantics are part
    // of it, not merely adjacent decorative text.
    expect(screen.getByRole("slider", { name: /Fraîches/ })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /Très lourdes/ })).toBeInTheDocument();
  });
});
