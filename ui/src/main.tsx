import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// WebView2's own menu offers "Save as" and "Print" of the page; keep it only where it helps: text fields and selected text.
document.addEventListener('contextmenu', (event) => {
  const editable = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')
  if (!editable && !window.getSelection()?.toString()) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
