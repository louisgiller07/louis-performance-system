import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

// Marketing site — fully independent from web/ (athlete product), still no
// Supabase adapter. `output` stays the default "static" (every page
// pre-rendered at build time) — the adapter is only here so the one route
// that opts out via `export const prerender = false`
// (src/pages/api/contact.ts) can run as a Vercel serverless function. That
// function is the sole piece of server-side logic on this site.
export default defineConfig({
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()],
  },
});
