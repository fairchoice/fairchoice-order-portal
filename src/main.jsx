import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.jsx'
import { isSupabaseConfigured } from './services/supabase.js'

function SupabaseConfigurationError() {
  return (
    <main className="min-h-screen bg-slate-100 p-6 flex items-center justify-center">
      <section
        role="alert"
        className="w-full max-w-xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-extrabold text-red-800">
          FairChoice configuration required
        </h1>
        <p className="mt-3 text-sm text-slate-700">
          Supabase is not configured for this deployment. Add
          VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the deployment
          environment, then redeploy the application.
        </p>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSupabaseConfigured ? <App /> : <SupabaseConfigurationError />}
  </StrictMode>,
)
