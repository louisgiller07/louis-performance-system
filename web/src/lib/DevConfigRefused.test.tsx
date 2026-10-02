import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DevConfigRefused } from "./DevConfigRefused";

describe("DevConfigRefused", () => {
  it("explains the refusal in the page, without any URL, key or token", () => {
    const { container } = render(<DevConfigRefused />);
    expect(screen.getByRole("heading", { name: "Configuration de développement refusée" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Le frontend est lancé en mode développement avec un backend Supabase distant.");
    expect(container.textContent).not.toMatch(/https?:\/\/|supabase\.co|sb_publishable|eyJ/);
  });
});
