import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

const { resetPasswordForEmail } = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { resetPasswordForEmail } },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function renderForgotPasswordPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

async function submit(user: ReturnType<typeof userEvent.setup>, email = "louis@example.test"): Promise<void> {
  await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: /Send reset link/ }));
}

// V0.3 — password-reset request phase. Same NAL-005-style discipline: never
// the raw provider .message, only curated French copy, branching on the
// stable documented AuthError.code.
describe("ForgotPasswordPage", () => {
  it("calls resetPasswordForEmail with the entered email and a redirectTo pointing at /reset-password", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderForgotPasswordPage();

    await submit(user);

    expect(resetPasswordForEmail).toHaveBeenCalledWith("louis@example.test", {
      redirectTo: expect.stringContaining("/reset-password"),
    });
  });

  it("shows the same non-committal 'check your email' message regardless of whether the email is registered", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderForgotPasswordPage();

    await submit(user);

    expect(await screen.findByText(/Check your email for a reset link/)).toBeInTheDocument();
  });

  it("shows a curated message for an invalid email, never the raw provider error", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: "email_address_invalid", name: "AuthApiError", message: "Unable to validate email address" },
    });
    const user = userEvent.setup();
    renderForgotPasswordPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Adresse email invalide.");
    expect(screen.queryByText(/Unable to validate email address/)).not.toBeInTheDocument();
  });

  it("shows a curated message when rate-limited", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: "over_email_send_rate_limit", name: "AuthApiError", message: "email rate limit exceeded" },
    });
    const user = userEvent.setup();
    renderForgotPasswordPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Trop de tentatives. Réessaie dans quelques minutes.");
  });

  it("falls back to a generic curated message for an unrecognized error code", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: "unexpected_failure", name: "AuthApiError", message: "Something broke internally" },
    });
    const user = userEvent.setup();
    renderForgotPasswordPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'envoyer le lien. Réessaie.");
    expect(screen.queryByText(/Something broke internally/)).not.toBeInTheDocument();
  });

  it("links back to /login", () => {
    renderForgotPasswordPage();
    expect(screen.getByRole("link", { name: "Back to login" })).toHaveAttribute("href", "/login");
  });
});
