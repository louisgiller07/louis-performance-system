import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ResetPasswordPage } from "./ResetPasswordPage";

const { updateUser } = vi.hoisted(() => ({ updateUser: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { updateUser } },
}));

const { useAuth } = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("./AuthContext", () => ({ useAuth }));

beforeEach(() => {
  vi.resetAllMocks();
});

function renderResetPasswordPage() {
  return render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>
  );
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  password = "new-horse-battery",
  confirmPassword = password
): Promise<void> {
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Confirm new password"), confirmPassword);
  await user.click(screen.getByRole("button", { name: /Update password/ }));
}

// V0.3 — password-reset completion phase. Reached only via the emailed
// recovery link, which Supabase JS parses into a session before this page
// gates on it. Same NAL-005-style curated-error discipline as the other auth
// pages.
describe("ResetPasswordPage", () => {
  it("shows a loading state while auth is resolving", () => {
    useAuth.mockReturnValue({ session: null, loading: true });
    renderResetPasswordPage();

    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("shows an invalid-link message with no form when there is no recovery session", () => {
    useAuth.mockReturnValue({ session: null, loading: false });
    renderResetPasswordPage();

    expect(screen.getByText(/This reset link is invalid or has expired/)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  it("shows a mismatch error and never calls updateUser when the two passwords differ", async () => {
    useAuth.mockReturnValue({ session: { access_token: "t" }, loading: false });
    const user = userEvent.setup();
    renderResetPasswordPage();

    await submit(user, "new-horse-battery", "different-battery");

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("calls updateUser with the new password when a recovery session is present", async () => {
    useAuth.mockReturnValue({ session: { access_token: "t" }, loading: false });
    updateUser.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderResetPasswordPage();

    await submit(user);

    expect(updateUser).toHaveBeenCalledWith({ password: "new-horse-battery" });
  });

  it("shows a curated message for a weak/short password, never the raw provider error", async () => {
    useAuth.mockReturnValue({ session: { access_token: "t" }, loading: false });
    updateUser.mockResolvedValue({
      data: null,
      error: { code: "weak_password", name: "AuthApiError", message: "Password should be at least 6 characters" },
    });
    const user = userEvent.setup();
    renderResetPasswordPage();

    await submit(user, "abcdef");

    expect(await screen.findByRole("alert")).toHaveTextContent("Mot de passe trop court (6 caractères minimum).");
    expect(screen.queryByText(/Password should be at least/)).not.toBeInTheDocument();
  });

  it("shows a curated message when reusing the same password", async () => {
    useAuth.mockReturnValue({ session: { access_token: "t" }, loading: false });
    updateUser.mockResolvedValue({
      data: null,
      error: { code: "same_password", name: "AuthApiError", message: "New password should be different" },
    });
    const user = userEvent.setup();
    renderResetPasswordPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Choisis un mot de passe différent de l'ancien.");
  });
});
