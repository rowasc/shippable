import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ServerHealthGate } from './components/ServerHealthGate'
import { CredentialsProvider } from './auth/useCredentials'
import { applyThemeToRoot, getStoredThemeId } from './tokens'

applyThemeToRoot(document.documentElement, getStoredThemeId())

// CredentialsProvider sits ABOVE ServerHealthGate so the gate can call
// useCredentials() at first paint. Hoisting also collapses what used to be
// two competing mount-time fetches (provider's authList + AppBody's
// rehydrate) into a single rehydrate that ends in authList — eliminating
// the boot-flash race that showed the Anthropic prompt before Keychain
// hydration finished.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CredentialsProvider>
      <ServerHealthGate>
        <App />
      </ServerHealthGate>
    </CredentialsProvider>
  </StrictMode>,
)
