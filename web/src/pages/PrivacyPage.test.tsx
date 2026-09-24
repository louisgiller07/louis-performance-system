import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App";
import { PRIVACY_CONTACT_EMAIL, PRIVACY_NOTICE_VERSION } from "../features/privacy/privacyNotice";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  },
}));

afterEach(() => {
  window.history.pushState({}, "", "/");
});

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("PrivacyPage (PILOT_012)", () => {
  it("/privacy is public: rendered without a session, never redirected to /login", async () => {
    renderAt("/privacy");

    expect(await screen.findByRole("heading", { name: "Confidentialité" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/privacy");
    expect(screen.queryByRole("button", { name: /Login/ })).not.toBeInTheDocument();
  });

  it("describes the collected data, the health data, access and observability, with the notice version", async () => {
    renderAt("/privacy");

    await screen.findByRole("heading", { name: "Confidentialité" });
    for (const title of ["Ce que NALYNT collecte", "Données liées à la santé", "Pourquoi", "Qui y a accès", "Métadonnées techniques", "Conservation et tes droits"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/suspicion de commotion cérébrale/)).toBeInTheDocument();
    expect(screen.getByText(/n'est pas un dispositif médical/)).toBeInTheDocument();
    expect(screen.getByText(`Version de la notice : ${PRIVACY_NOTICE_VERSION}`)).toBeInTheDocument();
  });

  it("shows the approved data controller identity, address and contact — no placeholder", async () => {
    const { container } = renderAt("/privacy");

    await screen.findByRole("heading", { name: "Confidentialité" });
    const operator = container.querySelector("address");
    expect(operator).not.toBeNull();
    for (const line of ["Louis Giller", "Clos de la Cure 1", "1609 St-Martin", "Suisse", PRIVACY_CONTACT_EMAIL]) {
      expect(operator!.textContent).toContain(line);
    }
    expect(container.textContent).not.toMatch(/à compléter|TODO|TBD/);
  });

  it("makes no unverified legal compliance claim", async () => {
    const { container } = renderAt("/privacy");

    await screen.findByRole("heading", { name: "Confidentialité" });
    expect(container.textContent).not.toMatch(/conforme|compliant|certifi|RGPD|GDPR|LPD/i);
  });
});
