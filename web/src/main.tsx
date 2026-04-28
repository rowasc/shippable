import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTokensToRoot } from './tokens'

applyTokensToRoot(document.documentElement)
document.documentElement.dataset.colorMode = 'dark'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
