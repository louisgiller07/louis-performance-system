// Local dev safety — the page shown instead of the app when the development
// server targets a remote Supabase without the explicit opt-in. Rendered by
// main.tsx BEFORE the app (and so the Supabase client) is ever loaded: no
// Supabase, no auth, no network. Never shows the URL, a key or a token.
export function DevConfigRefused() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 bg-bg px-6 text-ink">
      <div role="alert" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
        <h1 className="text-xl font-bold">Configuration de développement refusée</h1>
        <p className="text-ink/80">Le frontend est lancé en mode développement avec un backend Supabase distant.</p>
        <p className="text-ink/80">
          Configure le Supabase local (voir <code>web/.env.example</code>) ou active explicitement l'accès distant pour le développement
          (<code className="break-all">VITE_ALLOW_REMOTE_SUPABASE_IN_DEV=true</code>).
        </p>
      </div>
    </main>
  );
}
