import { useEffect } from 'react'
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './components/pages/HomePage'
import { AgentsPage } from './components/pages/AgentsPage'
import { SessionsPage } from './components/pages/SessionsPage'
import { ChatPage } from './components/pages/ChatPage'
import { ProjectsPage } from './components/pages/ProjectsPage'
import { ProjectWorkspacePage } from './components/pages/ProjectWorkspacePage'
import { SkillsPage } from './components/pages/SkillsPage'
import { SettingsPage } from './components/pages/SettingsPage'
import { TeamPage } from './components/pages/TeamPage'

function RouteLogger() {
  const location = useLocation()

  useEffect(() => {
    void window.appRuntime.trackUsage({
      category: 'navigation',
      action: 'route_change',
      status: 'ok',
      details: { path: location.pathname },
    })
  }, [location.pathname])

  return null
}

/**
 * Renders the routed pages.
 *
 * `ChatPage` is intentionally rendered here at the top level (rather than as a
 * `<Route>` element) and only hidden via CSS when the active route is not
 * `/chat`. This keeps the WebSocket event listeners, in-memory `sessionMap`,
 * pending streaming state, and the connection status alive across navigation,
 * so leaving the chat for the home page and returning does not lose the live
 * conversation state until the next event arrives.
 */
function RoutedContent() {
  const location = useLocation()
  const isChatRoute = location.pathname === '/chat'

  return (
    <>
      <div className={isChatRoute ? 'h-full' : 'hidden'} aria-hidden={!isChatRoute}>
        <ChatPage />
      </div>
      <div className={isChatRoute ? 'hidden' : 'h-full'} aria-hidden={isChatRoute}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          {/* /chat is rendered above as an always-mounted view; this route
              entry exists so navigation to /chat is still recognised but
              renders nothing inside the hidden Routes container. */}
          <Route path="/chat" element={null} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/team" element={<TeamPage />} />
        </Routes>
      </div>
    </>
  )
}

function App() {
  useEffect(() => {
    void window.appRuntime.logRenderer('info', 'Renderer started')
    void window.appRuntime.trackUsage({
      category: 'app',
      action: 'renderer_start',
      status: 'ok',
    })
  }, [])

  return (
    <Router>
      <RouteLogger />
      <AppLayout>
        <RoutedContent />
      </AppLayout>
    </Router>
  )
}

export default App
