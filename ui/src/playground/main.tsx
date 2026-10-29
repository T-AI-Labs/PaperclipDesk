import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from '../App.tsx'
import Controls from './Controls'
import { installHost } from './host'
import PaperclipStandIn from './PaperclipStandIn'

// The shell asks the host for its first snapshot while rendering, so the fake host must answer before React starts.
installHost()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PaperclipStandIn />
    <App />
    <Controls />
  </StrictMode>,
)
