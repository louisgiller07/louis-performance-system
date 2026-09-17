import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SignupPage } from "./SignupPage";

const { signUp, signInWithOAuth } = vi.hoisted(() => ({ signUp: vi.fn(), signInWithOAuth: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signUp, signInWithOAuth } },
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ session: null }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function renderSignupPage() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>
  );
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  email = "louis@example.test",
  password = "correct-horse",
  confirmPassword = password
): Promise<void> {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmPassword);
  await user.click(screen.getByRole("button", { name: /Create account/ }));
}

// V0.3 — Marketing -> Signup -> App flow. Same NAL-005-style discipline as
// LoginPage: never the raw provider .message, only curated French copy —
// but here branching on AuthError.code (a stable, documented part of the
// Supabase Auth API contract), never on fragile English .message text.
describe("SignupPage", () => {
  it("calls signUp with exactly the entered credentials", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user);

    expect(signUp).toHaveBeenCalledWith({ email: "louis@example.test", password: "correct-horse" });
  });

  it("shows a curated French message, never the raw provider error, for an already-registered email", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: { code: "email_exists", name: "AuthApiError", message: "User already registered" } });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Un compte existe déjà avec cette adresse email.");
    expect(screen.queryByText(/User already registered/)).not.toBeInTheDocument();
  });

  it("shows a curated French message for a weak/short password", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: { code: "weak_password", name: "AuthApiError", message: "Password should be at least 6 characters" } });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user, "louis@example.test", "abc");

    expect(await screen.findByRole("alert")).toHaveTextContent("Mot de passe trop court (6 caractères minimum).");
    expect(screen.queryByText(/Password should be at least/)).not.toBeInTheDocument();
  });

  it("shows a curated French message for an invalid email", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: { code: "email_address_invalid", name: "AuthApiError", message: "Unable to validate email address" } });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Adresse email invalide.");
  });

  it("falls back to a generic curated message for an unrecognized error code", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: { code: "unexpected_failure", name: "AuthApiError", message: "Something broke internally" } });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de créer le compte. Réessaie.");
    expect(screen.queryByText(/Something broke internally/)).not.toBeInTheDocument();
  });

  it("shows a 'check your email' state when signUp succeeds without a session (email confirmation required)", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user);

    expect(await screen.findByText(/Check your email to confirm your account/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no error and no 'check your email' state when signUp returns a session immediately", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user);

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Check your email/)).not.toBeInTheDocument();
  });

  it("shows a mismatch error and never calls signUp when the two passwords differ", async () => {
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user, "louis@example.test", "correct-horse", "different-horse");

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("links to /login for an existing account", () => {
    renderSignupPage();
    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute("href", "/login");
  });

  it("shows a 'Continue with Google' button and calls signInWithOAuth with the google provider on click", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderSignupPage();

    await user.click(screen.getByRole("button", { name: /Continue with Google/ }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: expect.stringContaining("/login") },
    });
  });

  it("shows a curated message, never the raw provider error, when signInWithOAuth itself fails", async () => {
    signInWithOAuth.mockResolvedValue({
      data: null,
      error: { code: "unexpected_failure", name: "AuthApiError", message: "boom" },
    });
    const user = userEvent.setup();
    renderSignupPage();

    await user.click(screen.getByRole("button", { name: /Continue with Google/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de se connecter avec Google. Réessaie.");
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("does not affect the email/password flow: signUp is unaffected by the Google button existing", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    const user = userEvent.setup();
    renderSignupPage();

    await submit(user);

    expect(signUp).toHaveBeenCalledWith({ email: "louis@example.test", password: "correct-horse" });
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
});
