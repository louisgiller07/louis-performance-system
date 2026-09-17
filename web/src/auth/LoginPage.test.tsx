import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";

const { signInWithPassword, signInWithOAuth } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signInWithPassword, signInWithOAuth } },
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ session: null }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

async function submit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("Email"), "louis@example.test");
  await user.type(screen.getByLabelText("Mot de passe"), "wrong-password");
  await user.click(screen.getByRole("button", { name: /Connexion/ }));
}

// V0.3_005C (NAL-005 auth-error language guard) — a Supabase Auth provider
// failure must never render its raw (English) message to the athlete.
describe("LoginPage", () => {
  it("shows French copy, never the raw provider error, on a generic sign-in failure", async () => {
    signInWithPassword.mockResolvedValue({ error: { name: "AuthApiError", message: "Invalid login credentials" } });
    const user = userEvent.setup();
    renderLoginPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de se connecter. Vérifie tes identifiants et réessaie.");
    expect(screen.queryByText(/Invalid login credentials/)).not.toBeInTheDocument();
  });

  it("shows the same French copy for a different provider error too — no error-code mapping introduced", async () => {
    signInWithPassword.mockResolvedValue({ error: { name: "AuthApiError", message: "Email not confirmed" } });
    const user = userEvent.setup();
    renderLoginPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de se connecter. Vérifie tes identifiants et réessaie.");
    expect(screen.queryByText(/Email not confirmed/)).not.toBeInTheDocument();
  });

  it("auth behavior is unchanged: signInWithPassword is still called with exactly the entered credentials", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderLoginPage();

    await submit(user);

    expect(signInWithPassword).toHaveBeenCalledWith({ email: "louis@example.test", password: "wrong-password" });
  });

  it("shows no error and no alert on success", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderLoginPage();

    await submit(user);

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a 'Continue with Google' button and calls signInWithOAuth with the google provider on click", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderLoginPage();

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
    renderLoginPage();

    await user.click(screen.getByRole("button", { name: /Continue with Google/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de se connecter avec Google. Réessaie.");
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("shows a curated 'cancelled' message and clears the URL when redirected back with an OAuth access_denied error", async () => {
    window.history.pushState({}, "", "/login?error=access_denied&error_code=access_denied&error_description=User+denied");

    renderLoginPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Connexion Google annulée.");
    expect(window.location.search).toBe("");
  });

  it("does not affect the email/password flow: no Google-related alert appears on a normal password failure", async () => {
    signInWithPassword.mockResolvedValue({ error: { name: "AuthApiError", message: "Invalid login credentials" } });
    const user = userEvent.setup();
    renderLoginPage();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de se connecter. Vérifie tes identifiants et réessaie.");
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
});
