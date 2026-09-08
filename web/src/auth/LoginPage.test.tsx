import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";

const { signInWithPassword } = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signInWithPassword } },
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ session: null }),
}));

beforeEach(() => {
  vi.resetAllMocks();
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
  await user.click(screen.getByRole("button", { name: /Se connecter/ }));
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
});
