import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { LoginGate } from './components/LoginGate'
import { NavBar } from './components/NavBar'
import { EventsPage } from './pages/EventsPage'
import { DashboardPage } from './pages/DashboardPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { SignalsPage } from './pages/SignalsPage'
import { AlertsPage } from './pages/AlertsPage'
import { SettingsPage } from './pages/SettingsPage'
import { useTheme } from './hooks/useTheme'

const queryClient = new QueryClient()

function App() {
  const { theme, toggleTheme } = useTheme()

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LoginGate>
          <div className="flex h-screen flex-col bg-bg text-fg">
            <NavBar theme={theme} onToggleTheme={toggleTheme} />
            <main className="min-h-0 flex-1">
              <Routes>
                <Route path="/" element={<EventsPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/analysis" element={<AnalysisPage />} />
                <Route path="/signals" element={<SignalsPage />} />
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </main>
          </div>
        </LoginGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
