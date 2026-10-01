# NALYNT web

## Local development

1. Start the local Supabase stack from the repository root: `npx supabase start`.
2. Copy `web/.env.example` to `web/.env.local` (git-ignored, machine-local) and set
   `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_PUBLISHABLE_KEY`
   (the `PUBLISHABLE_KEY` printed by `npx supabase status -o env`).
3. To use the Edge Functions locally, run `npx supabase functions serve` from the repository root.
4. `npm run dev`.

**Local dev safety.** In development mode (`npm run dev`, vitest) the app refuses any
non-local Supabase URL before creating its client: « Le frontend est lancé en mode
développement avec un backend Supabase distant. Configuration refusée par sécurité. »
(`src/lib/supabaseTarget.ts`). Working against a remote project from a dev server needs the
explicit opt-in `VITE_ALLOW_REMOTE_SUPABASE_IN_DEV=true`. Production builds are not affected.

---

# React + TypeScript + Vite (template notes)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
