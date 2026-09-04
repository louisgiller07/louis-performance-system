import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AthleteBootstrap } from "./AthleteBootstrap";
import { AthleteBootstrapError } from "./athleteBootstrapRepo";

const createOwnAthlete = vi.fn();
vi.mock("./athleteBootstrapRepo", async () => {
  const actual = await vi.importActual<typeof import("./athleteBootstrapRepo")>("./athleteBootstrapRepo");
  return {
    ...actual,
    createOwnAthlete: (...args: unknown[]) => createOwnAthlete(...args),
  };
});

const refreshAthlete = vi.fn();
let mockUser: { id: string; email: string } | null = { id: "user-1", email: "louis@example.test" };

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
    refreshAthlete,
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mockUser = { id: "user-1", email: "louis@example.test" };
});

function renderBootstrap() {
  return render(<AthleteBootstrap />);
}

async function submitName(name: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText("Nom");
  if (name) await user.type(input, name);
  await user.click(screen.getByRole("button", { name: /continuer|création/i }));
}

describe("AthleteBootstrap", () => {
  it("renders the minimal setup surface: title, supporting text, one field, one button", () => {
    renderBootstrap();
    expect(screen.getByText("Configurer ton profil")).toBeInTheDocument();
    expect(screen.getByText("Entre ton nom pour commencer.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuer" })).toBeInTheDocument();
  });

  it("B — empty name: submit rejected, never calls createOwnAthlete", async () => {
    renderBootstrap();
    await submitName("");
    expect(await screen.findByRole("alert")).toHaveTextContent("Entre ton nom pour continuer.");
    expect(createOwnAthlete).not.toHaveBeenCalled();
  });

  it("C — whitespace-only name: rejected, never calls createOwnAthlete", async () => {
    renderBootstrap();
    await submitName("   ");
    expect(await screen.findByRole("alert")).toHaveTextContent("Entre ton nom pour continuer.");
    expect(createOwnAthlete).not.toHaveBeenCalled();
  });

  it("D — valid name with surrounding whitespace: the trimmed value is sent, never the raw input", async () => {
    createOwnAthlete.mockResolvedValue(undefined);
    refreshAthlete.mockResolvedValue({ status: "resolved", athleteId: "athlete-1" });
    renderBootstrap();
    await submitName("  Louis Giller  ");
    await waitFor(() => expect(createOwnAthlete).toHaveBeenCalledWith("user-1", "Louis Giller"));
  });

  it("successful creation refreshes athlete resolution and shows no error", async () => {
    createOwnAthlete.mockResolvedValue(undefined);
    refreshAthlete.mockResolvedValue({ status: "resolved", athleteId: "athlete-1" });
    renderBootstrap();
    await submitName("Louis");
    await waitFor(() => expect(refreshAthlete).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("G — insert failure that re-resolves to still no_athlete: shows the repo's own error message", async () => {
    createOwnAthlete.mockRejectedValue(new AthleteBootstrapError());
    refreshAthlete.mockResolvedValue({ status: "no_athlete" });
    renderBootstrap();
    await submitName("Louis");
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de créer ton profil athlète. Réessaie dans un instant.");
  });

  it("duplicate/race: insert fails (e.g. UNIQUE(user_id)) but re-resolution now finds a usable athlete — no error shown, treated as success", async () => {
    createOwnAthlete.mockRejectedValue(new AthleteBootstrapError());
    refreshAthlete.mockResolvedValue({ status: "resolved", athleteId: "athlete-from-other-attempt" });
    renderBootstrap();
    await submitName("Louis");
    await waitFor(() => expect(refreshAthlete).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("H — double submit: the button is disabled while a request is in flight, only one createOwnAthlete call", async () => {
    let resolveInsert!: () => void;
    createOwnAthlete.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInsert = resolve;
      })
    );
    refreshAthlete.mockResolvedValue({ status: "resolved", athleteId: "athlete-1" });

    const user = userEvent.setup();
    renderBootstrap();
    await user.type(screen.getByLabelText("Nom"), "Louis");

    const button = screen.getByRole("button", { name: "Continuer" });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button); // second click while still in flight must be a no-op

    resolveInsert();
    await waitFor(() => expect(refreshAthlete).toHaveBeenCalledTimes(1));
    expect(createOwnAthlete).toHaveBeenCalledTimes(1);
  });

  it("no user in context (session disappeared): shows a session error, never calls createOwnAthlete", async () => {
    mockUser = null;
    renderBootstrap();
    await submitName("Louis");
    expect(await screen.findByRole("alert")).toHaveTextContent("Ta session a expiré. Reconnecte-toi.");
    expect(createOwnAthlete).not.toHaveBeenCalled();
  });
});
