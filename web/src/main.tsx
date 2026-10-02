import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-800.css'
import './index.css'
import { isSupabaseTargetAllowed } from './lib/supabaseTarget'
import { DevConfigRefused } from './lib/DevConfigRefused'

const root = createRoot(document.getElementById('root')!)

// Local dev safety: the target is checked BEFORE the app is loaded, because
// loading it creates the Supabase client. A refused development configuration
// shows a plain page (no client, no request); the client module keeps its own
// assertion as defense in depth.
if (!isSupabaseTargetAllowed(import.meta.env)) {
  root.render(<DevConfigRefused />)
} else {
  void import('./App.tsx').then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
}
