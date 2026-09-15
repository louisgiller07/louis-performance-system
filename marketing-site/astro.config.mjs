import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Marketing site — fully independent from web/ (athlete product). No SSR
// backend, no Supabase adapter, no deployment config at this stage.
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
