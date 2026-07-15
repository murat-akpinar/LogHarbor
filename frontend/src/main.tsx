import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @ts-expect-error fontsource packages don't have type definitions
import '@fontsource-variable/inter'
// @ts-expect-error fontsource packages don't have type definitions
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
