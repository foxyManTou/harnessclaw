import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LauncherPage } from './components/pages/LauncherPage'
import './assets/index.css'
import './lib/i18n'

/**
 * Two renderer entry modes share a single bundle:
 *
 *   • Main app    — default hash (#/, #/chat, …) renders <App />, the
 *                   full HashRouter UI with sidebar, pages, etc.
 *   • Quick launcher — when the main process opens a BrowserWindow at
 *                   `#/launcher`, we mount the lightweight
 *                   <LauncherPage /> directly with no router shell.
 *
 * Branching at the entry keeps the launcher window free of the chat
 * runtime (no WebSocket subscriptions, no sidebar, no React Router)
 * so it stays small and snappy.
 */
const isLauncherWindow = window.location.hash.startsWith('#/launcher')

if (isLauncherWindow) {
  document.documentElement.classList.add('launcher-window')
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isLauncherWindow ? <LauncherPage /> : <App />}
  </React.StrictMode>
)
