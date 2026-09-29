import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { SignupPage } from "./SignupPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
// Vite raw import (typed by vite/client) — no Node API needed in the web test environment.
import indexHtml from "../../index.html?raw";

/**
 * REV-015.5 — every auth page (and every state of it) shows French only.
 * Display copy only: the Supabase calls, validations, error-code mappings
 * and redirects are covered unchanged by each page's own test file.
 */
const { signInWithPassword, signUp, resetPasswordForEmail, updateUser, signInWithOAuth } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signInWithOAuth: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signInWithPassword, signUp, resetPasswordForEmail, updateUser, signInWithOAuth } },
}));

const { useAuth } = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("./AuthContext", () => ({ useAuth }));

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ session: null, loading: false });
});

// Every English string these pages used to render (REV-015.5 audit).
const ENGLISH =
  /Your AI|race performance|\bOr\b|\bEmail\b|Forgot password|Don't have an account|Create one|Designed for|Continue with Google|Redirecting|Passwords don't match|Check your email|We sent|Join NALYNT|Create your free|\bPassword\b|Confirm password|Creating account|Create account|Already have an account|\bLogin\b|reset link|If an account exists|Reset your password|We'll email|Send reset link|Sending|Back to login|invalid or has expired|Request a new link|Set a new password|New password|Updating|Update password/;

const never = () => new Promise(() => {}); // a Supabase call left pending — keeps the page in its loading state

function renderAt(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("auth pages — no English visible (REV-015.5)", () => {
  it("LoginPage: French copy (tagline, e-mail label, links, Google)", () => {
    const { container } = renderAt(<LoginPage />);

    expect(screen.getByText("Ton coach de performance IA")).toBeInTheDocument();
    expect(screen.getByText("Ton coach IA pour l'entraînement, la récupération et la performance en course.")).toBeInTheDocument();
    expect(screen.getByLabelText("Adresse e-mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mot de passe oublié ?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crée-en un" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuer avec Google/ })).toBeInTheDocument();
    expect(screen.getByText("Conçu pour")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(ENGLISH);
  });

  it("SignupPage: form and 'confirm your e-mail' state", async () => {
    const user = userEvent.setup();
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    const { container } = renderAt(<SignupPage />);

    expect(screen.getByText("Rejoins NALYNT")).toBeInTheDocument();
    expect(screen.getByText("Crée ton compte athlète gratuit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(ENGLISH);

    await user.type(screen.getByLabelText("Adresse e-mail"), "rider@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "secret123");
    await user.type(screen.getByLabelText("Confirme le mot de passe"), "secret123");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Vérifie ta boîte mail pour confirmer ton compte.")).toBeInTheDocument();
    expect(container.textContent).toContain("Nous avons envoyé un lien de confirmation à rider@example.com.");
    expect(container.textContent).not.toMatch(ENGLISH);
  });

  it("SignupPage: password mismatch message is French, signUp never called", async () => {
    const user = userEvent.setup();
    renderAt(<SignupPage />);

    await user.type(screen.getByLabelText("Adresse e-mail"), "rider@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "secret123");
    await user.type(screen.getByLabelText("Confirme le mot de passe"), "secret124");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Les mots de passe ne correspondent pas.");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("ForgotPasswordPage: form and neutral 'sent' state", async () => {
    const user = userEvent.setup();
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const { container } = renderAt(<ForgotPasswordPage />);

    expect(screen.getByText("Réinitialise ton mot de passe")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour à la connexion" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(ENGLISH);

    await user.type(screen.getByLabelText("Adresse e-mail"), "rider@example.com");
    await user.click(screen.getByRole("button", { name: "Envoyer le lien" }));

    expect(await screen.findByText("Vérifie ta boîte mail.")).toBeInTheDocument();
    // Still non-committal: never confirms the account exists.
    expect(container.textContent).toContain("Si un compte existe pour rider@example.com");
    expect(container.textContent).not.toMatch(ENGLISH);
  });

  it("ResetPasswordPage: invalid/expired link state and form", () => {
    const { container, unmount } = renderAt(<ResetPasswordPage />);
    expect(screen.getByText("Ce lien de réinitialisation est invalide ou a expiré.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Demander un nouveau lien" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(ENGLISH);
    unmount();

    useAuth.mockReturnValue({ session: { user: { id: "u" } }, loading: false });
    const form = renderAt(<ResetPasswordPage />);
    expect(screen.getByText("Choisis un nouveau mot de passe")).toBeInTheDocument();
    expect(screen.getByLabelText("Nouveau mot de passe")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirme le nouveau mot de passe")).toBeInTheDocument();
    expect(form.container.textContent).not.toMatch(ENGLISH);
  });
});

describe("auth pages — loading states are French (REV-015.5)", () => {
  it("Login: 'Connexion…'", async () => {
    const user = userEvent.setup();
    signInWithPassword.mockReturnValue(never());
    renderAt(<LoginPage />);

    await user.type(screen.getByLabelText("Adresse e-mail"), "rider@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "secret123");
    await user.click(screen.getByRole("button", { name: "Connexion" }));

    expect(screen.getByRole("button", { name: "Connexion…" })).toBeDisabled();
  });

  it("Google: 'Redirection…'", async () => {
    const user = userEvent.setup();
    signInWithOAuth.mockReturnValue(never());
    renderAt(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /Continuer avec Google/ }));

    expect(screen.getByRole("button", { name: /Redirection…/ })).toBeDisabled();
  });

  it("Signup: 'Création du compte…'", async () => {
    const user = userEvent.setup();
    signUp.mockReturnValue(never());
    renderAt(<SignupPage />);

    await user.type(screen.getByLabelText("Adresse e-mail"), "rider@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "secret123");
    await user.type(screen.getByLabelText("Confirme le mot de passe"), "secret123");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(screen.getByRole("button", { name: "Création du compte…" })).toBeDisabled();
  });

  it("Forgot password: 'Envoi…'", async () => {
    const user = userEvent.setup();
    resetPasswordForEmail.mockReturnValue(never());
    renderAt(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText("Adresse e-mail"), "rider@example.com");
    await user.click(screen.getByRole("button", { name: "Envoyer le lien" }));

    expect(screen.getByRole("button", { name: "Envoi…" })).toBeDisabled();
  });

  it("Reset password: 'Mise à jour…'", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ session: { user: { id: "u" } }, loading: false });
    updateUser.mockReturnValue(never());
    renderAt(<ResetPasswordPage />);

    await user.type(screen.getByLabelText("Nouveau mot de passe"), "secret123");
    await user.type(screen.getByLabelText("Confirme le nouveau mot de passe"), "secret123");
    await user.click(screen.getByRole("button", { name: "Mettre à jour le mot de passe" }));

    expect(screen.getByRole("button", { name: "Mise à jour…" })).toBeDisabled();
  });
});

describe("web/index.html (REV-015.5)", () => {
  it("declares the document language as French", () => {
    expect(indexHtml).toContain('<html lang="fr">');
    expect(indexHtml).not.toContain('lang="en"');
  });
});
