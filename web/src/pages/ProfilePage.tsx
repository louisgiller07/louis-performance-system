import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";
import { AppHeader } from "../components/AppHeader";

// UX-02 — the Profil tab: everything that used to sit permanently in the
// header (e-mail, Configuration, Déconnexion) plus the privacy notice that
// used to be in the footer. No new setting is invented here — each row
// links to a screen that already exists.
const ROWS = [
  {
    to: "/performance-setup",
    title: "Affiner ton profil",
    description: "Matériel, terrain, priorités de pilotage, créneaux jour par jour et génération de ton plan.",
  },
  {
    to: "/privacy",
    title: "Confidentialité",
    description: "Tes données et la façon dont NALYNT les utilise.",
  },
];

export function ProfilePage() {
  const { user, signOut } = useAuth();

  return (
    <PageShell header={<AppHeader />}>
      <section className="ux-enter pt-2">
        <p className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          Profil
        </p>
        <h1 className="mt-3 font-display text-4xl font-extrabold uppercase leading-none text-ink">Ton compte</h1>
        {user?.email && <p className="mt-3 break-all text-sm text-muted">{user.email}</p>}
      </section>

      <nav aria-label="Profil" className="ux-enter flex flex-col overflow-hidden rounded-xl border border-line bg-card" style={{ ["--d" as string]: "80ms" }}>
        {ROWS.map((row) => (
          <Link
            key={row.to}
            to={row.to}
            className="ux-press group flex min-h-16 items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0 hover:bg-card-2"
          >
            <span>
              <span className="block font-medium text-ink">{row.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{row.description}</span>
            </span>
            <span className="text-gold transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => void signOut()}
        className="ux-enter ux-press min-h-12 rounded-xl border border-line px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-ink/80 hover:border-red-500/50 hover:text-red-300"
        style={{ ["--d" as string]: "160ms" }}
      >
        Déconnexion
      </button>
    </PageShell>
  );
}
