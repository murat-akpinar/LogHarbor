import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { LoginGate } from './components/LoginGate'
import { NavBar } from './components/NavBar'
import { EventsPage } from './pages/EventsPage'
import { RequestsPage } from './pages/RequestsPage'
import { ExceptionsPage } from './pages/ExceptionsPage'
import { QueriesPage } from './pages/QueriesPage'
import { DashboardPage } from './pages/DashboardPage'
import { ServicesPage } from './pages/ServicesPage'
import { UsersPage } from './pages/UsersPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { SignalsPage } from './pages/SignalsPage'
import { AlertsPage } from './pages/AlertsPage'
import { SettingsPage } from './pages/SettingsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { LanguageProvider } from './i18n'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <BrowserRouter>
          <LoginGate>
            <div className="flex h-screen flex-col text-fg">
              <NavBar />
              <main className="min-h-0 flex-1">
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/requests" element={<RequestsPage />} />
                  <Route path="/exceptions" element={<ExceptionsPage />} />
                  <Route path="/queries" element={<QueriesPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/analysis" element={<AnalysisPage />} />
                  <Route path="/signals" element={<SignalsPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </main>
            </div>
          </LoginGate>
        </BrowserRouter>
      </LanguageProvider>
    </QueryClientProvider>
  )
}

export default App
